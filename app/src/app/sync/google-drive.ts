import {
  DriveAdapter,
  DriveAuthError,
  DriveFileInfo,
  DriveQuotaError,
  DriveTimeoutError,
  DriveTransientError,
} from './drive-adapter';

export interface TokenSource {
  token(): string | null;
}

export const CHUNK_SIZE = 8 * 1024 * 1024;
/** Backoff before each retry of a chunk after a network error. */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
const BASE = 'https://www.googleapis.com';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,modifiedTime,size';
/** Longest a request or a single download read may go without an answer. */
const REQUEST_TIMEOUT_MS = 60_000;

/** Shape of a Drive v3 file resource as this adapter requests it. */
interface DriveFileResource {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
  appProperties?: Record<string, string>;
}

type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs one step under a deadline. The step is raced against the deadline, so a fetch that
 * ignores its abort signal still fails. The signal aborts the step's fetch when time runs out
 * or the caller's signal aborts.
 */
function withDeadline<T>(
  ms: number,
  step: (signal: AbortSignal) => Promise<T>,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onExternal: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DriveTimeoutError());
      controller.abort();
    }, ms);
    if (external) {
      onExternal = () => {
        reject(new DOMException('Aborted', 'AbortError'));
        controller.abort();
      };
      if (external.aborted) onExternal();
      else external.addEventListener('abort', onExternal);
    }
  });
  return Promise.race([step(controller.signal), deadline]).finally(() => {
    clearTimeout(timer);
    if (external && onExternal) external.removeEventListener('abort', onExternal);
  });
}

/** Drive adapter that talks to the Drive v3 REST API with fetch. */
export class GoogleDrive implements DriveAdapter {
  private readonly fetchFn: typeof fetch;

  /**
   * fetch is wrapped rather than stored as-is: calling a bare `fetch` as a
   * method of this instance throws "Illegal invocation" in browsers.
   */
  constructor(
    private readonly tokens: TokenSource,
    fetchFn: typeof fetch = (input, init) => fetch(input, init),
    private readonly sleep: Sleep = defaultSleep,
  ) {
    this.fetchFn = fetchFn;
  }

  async listAppData(): Promise<DriveFileInfo[]> {
    const all: DriveFileInfo[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        fields: 'nextPageToken,files(id,name,modifiedTime)',
        pageSize: '1000',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const json = await this.getJson<{ files?: DriveFileResource[]; nextPageToken?: string }>(
        `${BASE}/drive/v3/files?${params}`,
        'list',
      );
      all.push(...(json.files ?? []).map(toInfo));
      pageToken = json.nextPageToken;
    } while (pageToken);
    return all;
  }

  readText(fileId: string): Promise<string> {
    return withDeadline(REQUEST_TIMEOUT_MS, async (signal) => {
      const res = await this.request(`${BASE}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { signal });
      await ensureOk(res, 'read');
      return res.text();
    });
  }

  writeAppDataJson(name: string, json: string, fileId?: string): Promise<DriveFileInfo> {
    return this.writeAppData(name, json, 'application/json; charset=UTF-8', fileId);
  }

  writeAppDataBlob(name: string, blob: Blob, fileId?: string): Promise<DriveFileInfo> {
    return this.writeAppData(name, blob, blob.type || 'application/octet-stream', fileId);
  }

  async ensureBooksFolder(): Promise<string> {
    const iqraId = (await this.findFolder('Iqra', 'root')) ?? (await this.createFolder('Iqra', 'root'));
    return (await this.findFolder('Books', iqraId)) ?? (await this.createFolder('Books', iqraId));
  }

  async uploadPdf(
    blob: Blob,
    name: string,
    folderId: string,
    bookId: string,
    onProgress?: (fraction: number) => void,
  ): Promise<DriveFileInfo> {
    const sessionUrl = await this.startResumableSession(blob, name, folderId, bookId);
    return this.sendChunks(sessionUrl, blob, onProgress);
  }

  /** The response may take up to 60 s to start, and each read may wait up to 60 s for more bytes. */
  async downloadBlob(fileId: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Blob> {
    const res = await withDeadline(
      REQUEST_TIMEOUT_MS,
      (deadlineSignal) => this.request(`${BASE}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { signal: deadlineSignal }),
      signal,
    );
    await ensureOk(res, 'download');
    const type = res.headers.get('Content-Type') ?? '';
    if (!res.body) {
      const blob = await withDeadline(REQUEST_TIMEOUT_MS, () => res.blob(), signal);
      onProgress?.(1);
      return blob;
    }

    const total = Number(res.headers.get('Content-Length')) || 0;
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await withDeadline(REQUEST_TIMEOUT_MS, () => reader.read(), signal).catch(async (error) => {
        await reader.cancel().catch(() => undefined);
        throw error;
      });
      if (done) break;
      parts.push(value);
      received += value.byteLength;
      if (total > 0) onProgress?.(received / total);
    }
    return new Blob(parts as BlobPart[], { type });
  }

  /** A 404 counts as success. */
  async deleteFile(fileId: string): Promise<void> {
    await withDeadline(REQUEST_TIMEOUT_MS, async (signal) => {
      const res = await this.request(`${BASE}/drive/v3/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', signal });
      if (res.status === 404) return;
      await ensureOk(res, 'delete');
    });
  }

  async storageQuota(): Promise<{ limit: number; usage: number }> {
    const json = await this.getJson<{ storageQuota: { limit?: string; usage?: string } }>(
      `${BASE}/drive/v3/about?fields=storageQuota`,
      'quota',
    );
    // Google omits the limit for accounts with unlimited storage.
    return {
      limit: json.storageQuota.limit !== undefined ? Number(json.storageQuota.limit) : Number.POSITIVE_INFINITY,
      usage: Number(json.storageQuota.usage ?? 0),
    };
  }

  mediaRequest(fileId: string): { url: string; httpHeaders: Record<string, string> } {
    const token = this.tokens.token();
    if (!token) throw new DriveAuthError();
    return {
      url: `${BASE}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      httpHeaders: { Authorization: `Bearer ${token}` },
    };
  }

  private async writeAppData(
    name: string,
    media: Blob | string,
    mediaType: string,
    fileId: string | undefined,
  ): Promise<DriveFileInfo> {
    if (fileId !== undefined) {
      const url = `${BASE}/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${FILE_FIELDS}`;
      return withDeadline(REQUEST_TIMEOUT_MS, async (signal) => {
        const res = await this.request(url, { method: 'PATCH', headers: { 'Content-Type': mediaType }, body: media, signal });
        await ensureOk(res, 'update');
        return toInfo((await res.json()) as DriveFileResource);
      });
    }

    const boundary = `iqra${Math.random().toString(36).slice(2)}`;
    const metadata = JSON.stringify({ name, parents: ['appDataFolder'] });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: ${mediaType}\r\n\r\n`,
      media,
      `\r\n--${boundary}--`,
    ]);
    const url = `${BASE}/upload/drive/v3/files?uploadType=multipart&fields=${FILE_FIELDS}`;
    return withDeadline(REQUEST_TIMEOUT_MS, async (signal) => {
      const res = await this.request(url, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
        signal,
      });
      await ensureOk(res, 'create');
      return toInfo((await res.json()) as DriveFileResource);
    });
  }

  private async startResumableSession(blob: Blob, name: string, folderId: string, bookId: string): Promise<string> {
    const metadata = { name, parents: [folderId], appProperties: { iqraBookId: bookId } };
    return withDeadline(REQUEST_TIMEOUT_MS, async (signal) => {
      const res = await this.request(`${BASE}/upload/drive/v3/files?uploadType=resumable&fields=${FILE_FIELDS}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': blob.type || 'application/pdf',
          'X-Upload-Content-Length': String(blob.size),
        },
        body: JSON.stringify(metadata),
        signal,
      });
      await ensureOk(res, 'upload start');
      const location = res.headers.get('Location');
      if (!location) throw new Error('Drive upload start returned no session URL');
      return location;
    });
  }

  /**
   * Sends the blob in CHUNK_SIZE pieces. A network error waits for the next
   * backoff delay, asks Drive how much it has committed, and resumes from there.
   */
  private async sendChunks(sessionUrl: string, blob: Blob, onProgress?: (fraction: number) => void): Promise<DriveFileInfo> {
    const total = blob.size;
    let offset = 0;
    let failures = 0;
    let recover = false;

    for (;;) {
      try {
        if (recover) {
          const committed = await this.queryCommitted(sessionUrl, total);
          if ('info' in committed) {
            onProgress?.(1);
            return committed.info;
          }
          offset = committed.offset;
          recover = false;
        }

        const end = Math.min(offset + CHUNK_SIZE, total);
        const range = total === 0 ? `bytes */0` : `bytes ${offset}-${end - 1}/${total}`;
        const outcome = await withDeadline(REQUEST_TIMEOUT_MS, async (signal) => {
          const res = await this.request(sessionUrl, {
            method: 'PUT',
            headers: { 'Content-Range': range },
            body: blob.slice(offset, end),
            signal,
          });
          if (res.status === 308) return { done: false as const };
          await ensureOk(res, 'upload');
          return { done: true as const, info: toInfo((await res.json()) as DriveFileResource) };
        });

        if (!outcome.done) {
          failures = 0;
          offset = end;
          onProgress?.(offset / total);
          continue;
        }
        onProgress?.(1);
        return outcome.info;
      } catch (error) {
        const retryable =
          error instanceof TypeError || error instanceof DriveTimeoutError || error instanceof DriveTransientError;
        if (!retryable || failures >= RETRY_DELAYS_MS.length) throw error;
        await this.sleep(RETRY_DELAYS_MS[failures]);
        failures += 1;
        recover = true;
      }
    }
  }

  /** Asks Drive which bytes it has committed: a 308 with a Range header, or 200/201 if the upload already finished. */
  private async queryCommitted(
    sessionUrl: string,
    total: number,
  ): Promise<{ offset: number } | { info: DriveFileInfo }> {
    return withDeadline(REQUEST_TIMEOUT_MS, async (signal) => {
      const res = await this.request(sessionUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes */${total}` },
        body: '',
        signal,
      });
      if (res.status === 308) {
        const last = /-(\d+)$/.exec(res.headers.get('Range') ?? '');
        return { offset: last ? Number(last[1]) + 1 : 0 };
      }
      await ensureOk(res, 'upload status');
      return { info: toInfo((await res.json()) as DriveFileResource) };
    });
  }

  private async findFolder(name: string, parentId: string): Promise<string | undefined> {
    const q = `name='${name}' and mimeType='${FOLDER_MIME}' and trashed=false and '${parentId}' in parents`;
    const params = new URLSearchParams({ q, fields: 'files(id,name)' });
    const json = await this.getJson<{ files?: DriveFileResource[] }>(`${BASE}/drive/v3/files?${params}`, 'folder search');
    return json.files?.[0]?.id;
  }

  private createFolder(name: string, parentId: string): Promise<string> {
    return withDeadline(REQUEST_TIMEOUT_MS, async (signal) => {
      const res = await this.request(`${BASE}/drive/v3/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
        signal,
      });
      await ensureOk(res, 'folder create');
      return ((await res.json()) as DriveFileResource).id;
    });
  }

  private getJson<T>(url: string, what: string): Promise<T> {
    return withDeadline(REQUEST_TIMEOUT_MS, async (signal) => {
      const res = await this.request(url, { signal });
      await ensureOk(res, what);
      return (await res.json()) as T;
    });
  }

  /**
   * Adds the bearer token and maps auth, quota and transient failures to their errors.
   * Other statuses are left to the caller.
   */
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = this.tokens.token();
    if (!token) throw new DriveAuthError();
    const headers = { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` };
    const res = await this.fetchFn(url, { ...init, headers });
    if (res.status === 401) throw new DriveAuthError(token);
    if (res.status === 403) throw await classifyForbidden(res, token);
    if (res.status === 429 || res.status >= 500) throw new DriveTransientError(`Drive failed with status ${res.status}`);
    return res;
  }
}

const AUTH_REASONS = new Set(['authError', 'invalidCredentials', 'insufficientPermissions']);
const TRANSIENT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError']);

/** Reads the Drive error reason of a 403. Only auth reasons, or no reason at all, mean a bad token. */
async function classifyForbidden(res: Response, token: string): Promise<Error> {
  let reasons: string[] = [];
  try {
    const body = (await res.clone().json()) as { error?: { errors?: { reason?: string }[]; status?: string } };
    reasons = (body.error?.errors ?? []).map((e) => e.reason ?? '');
  } catch {
    // No readable body: treat as an auth failure.
  }
  if (reasons.includes('storageQuotaExceeded')) return new DriveQuotaError();
  if (reasons.some((r) => TRANSIENT_REASONS.has(r))) return new DriveTransientError('Drive is busy, try again later');
  // Only auth reasons (or a 403 that names none) mean a bad token. Any other reason, such as
  // dailyLimitExceeded or domainPolicy, is not fixed by signing in again.
  const named = reasons.filter((r) => r !== '');
  if (named.length === 0 || named.some((r) => AUTH_REASONS.has(r))) return new DriveAuthError(token);
  return new DriveTransientError(`Drive refused the request (${named.join(', ')})`);
}

async function ensureOk(res: Response, what: string): Promise<void> {
  if (!res.ok) throw new Error(`Drive ${what} failed with status ${res.status}`);
}

function toInfo(file: DriveFileResource): DriveFileInfo {
  const info: DriveFileInfo = {
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime ?? '',
  };
  if (file.size !== undefined) info.size = Number(file.size);
  if (file.appProperties !== undefined) info.appProperties = file.appProperties;
  return info;
}
