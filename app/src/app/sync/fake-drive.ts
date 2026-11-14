import { DriveAdapter, DriveFileInfo } from './drive-adapter';

type Space = 'appData' | 'drive';

interface Entry {
  info: DriveFileInfo;
  data: Blob | string;
  space: Space;
  folder?: boolean;
  parentId?: string;
  /** Raw bytes of a Blob entry, so exportState can stay synchronous. */
  bytes?: Uint8Array;
}

interface ExportedEntry {
  id: string;
  info: DriveFileInfo;
  space: Space;
  folder: boolean;
  parentId?: string;
  type: string;
  encoding: 'text' | 'base64';
  content: string;
}

interface ExportedState {
  clock: number;
  nextId: number;
  entries: ExportedEntry[];
}

const EPOCH_MS = Date.UTC(2026, 0, 1);
const QUOTA_LIMIT = 15 * 1024 ** 3;

/**
 * In-memory DriveAdapter for tests and e2e runs.
 * failNext applies to the next promise-returning call; mediaRequest, exportState and importState are synchronous.
 */
export class FakeDrive implements DriveAdapter {
  private readonly files = new Map<string, Entry>();
  private clock = 0;
  private nextId = 1;
  private pendingError: Error | null = null;

  failNext(error: Error): void {
    this.pendingError = error;
  }

  /** Test helper: names of folders in creation order. */
  folderNames(): string[] {
    return [...this.files.values()].filter((e) => e.folder).map((e) => e.info.name);
  }

  exportState(): string {
    const entries: ExportedEntry[] = [...this.files].map(([id, e]) => {
      const base = { id, info: e.info, space: e.space, folder: e.folder ?? false, parentId: e.parentId };
      if (typeof e.data === 'string') {
        return { ...base, type: '', encoding: 'text', content: e.data };
      }
      if (!e.bytes) throw new Error(`Blob bytes missing for ${id}`);
      return { ...base, type: e.data.type, encoding: 'base64', content: toBase64(e.bytes) };
    });
    const state: ExportedState = { clock: this.clock, nextId: this.nextId, entries };
    return JSON.stringify(state);
  }

  importState(json: string): void {
    const state = JSON.parse(json) as ExportedState;
    this.files.clear();
    this.clock = state.clock;
    this.nextId = state.nextId;
    for (const e of state.entries) {
      if (e.encoding === 'text') {
        this.files.set(e.id, { info: e.info, data: e.content, space: e.space, folder: e.folder, parentId: e.parentId });
      } else {
        const bytes = fromBase64(e.content);
        this.files.set(e.id, {
          info: e.info,
          data: new Blob([bytes], { type: e.type }),
          space: e.space,
          parentId: e.parentId,
          bytes,
        });
      }
    }
  }

  async listAppData(): Promise<DriveFileInfo[]> {
    await this.gate();
    return [...this.files.values()].filter((e) => e.space === 'appData' && !e.folder).map((e) => structuredClone(e.info));
  }

  async readText(fileId: string): Promise<string> {
    await this.gate();
    const entry = this.require(fileId);
    return typeof entry.data === 'string' ? entry.data : entry.data.text();
  }

  writeAppDataJson(name: string, json: string, fileId?: string): Promise<DriveFileInfo> {
    return this.put('appData', name, json, { fileId });
  }

  writeAppDataBlob(name: string, blob: Blob, fileId?: string): Promise<DriveFileInfo> {
    return this.put('appData', name, blob, { fileId });
  }

  async ensureBooksFolder(): Promise<string> {
    await this.gate();
    const iqraId = this.findFolder('Iqra', undefined) ?? this.createFolder('Iqra', undefined);
    return this.findFolder('Books', iqraId) ?? this.createFolder('Books', iqraId);
  }

  uploadPdf(
    blob: Blob,
    name: string,
    folderId: string,
    bookId: string,
    onProgress?: (fraction: number) => void,
  ): Promise<DriveFileInfo> {
    return this.put('drive', name, blob, { parentId: folderId, appProperties: { iqraBookId: bookId } }).then((info) => {
      onProgress?.(1);
      return info;
    });
  }

  async downloadBlob(fileId: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Blob> {
    await this.gate();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const entry = this.require(fileId);
    onProgress?.(1);
    return typeof entry.data === 'string' ? new Blob([entry.data]) : entry.data;
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.gate();
    this.files.delete(fileId);
  }

  async storageQuota(): Promise<{ limit: number; usage: number }> {
    await this.gate();
    const usage = [...this.files.values()].reduce((sum, e) => sum + (e.info.size ?? 0), 0);
    return { limit: QUOTA_LIMIT, usage };
  }

  mediaRequest(fileId: string): { url: string; httpHeaders: Record<string, string> } {
    return { url: 'fake://' + fileId, httpHeaders: {} };
  }

  private async put(
    space: Space,
    name: string,
    data: Blob | string,
    options: { fileId?: string; parentId?: string; appProperties?: Record<string, string> },
  ): Promise<DriveFileInfo> {
    await this.gate();
    const existing = options.fileId !== undefined ? this.files.get(options.fileId) : undefined;
    if (options.fileId !== undefined && (!existing || existing.space !== space || existing.folder)) {
      throw new Error(`File not found: ${options.fileId}`);
    }
    const bytes = typeof data === 'string' ? undefined : new Uint8Array(await data.arrayBuffer());
    const size = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.size;
    const id = options.fileId ?? this.newId();
    const info: DriveFileInfo = {
      id,
      name,
      modifiedTime: this.tick(),
      size,
      appProperties: options.appProperties ?? existing?.info.appProperties,
    };
    this.files.set(id, { info, data, space, parentId: options.parentId, bytes });
    return structuredClone(info);
  }

  private findFolder(name: string, parentId: string | undefined): string | undefined {
    for (const [id, e] of this.files) {
      if (e.folder && e.info.name === name && e.parentId === parentId) return id;
    }
    return undefined;
  }

  private createFolder(name: string, parentId: string | undefined): string {
    const id = this.newId();
    this.files.set(id, { info: { id, name, modifiedTime: this.tick() }, data: '', space: 'drive', folder: true, parentId });
    return id;
  }

  private require(fileId: string): Entry {
    const entry = this.files.get(fileId);
    if (!entry || entry.folder) throw new Error(`File not found: ${fileId}`);
    return entry;
  }

  private tick(): string {
    this.clock += 1;
    return new Date(EPOCH_MS + this.clock * 1000).toISOString();
  }

  private newId(): string {
    return `fake-${this.nextId++}`;
  }

  private async gate(): Promise<void> {
    if (!this.pendingError) return;
    const error = this.pendingError;
    this.pendingError = null;
    throw error;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
