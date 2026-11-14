import { DriveAuthError } from './drive-adapter';
import { FakeDrive } from './fake-drive';

async function bytesOf(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

describe('FakeDrive', () => {
  let drive: FakeDrive;

  beforeEach(() => {
    drive = new FakeDrive();
  });

  it('writeAppDataJson then listAppData returns one file with that name', async () => {
    await drive.writeAppDataJson('a.json', '{}');
    const files = await drive.listAppData();
    expect(files.length).toBe(1);
    expect(files[0].name).toBe('a.json');
  });

  it('a second write with the same fileId keeps the id and advances modifiedTime', async () => {
    const first = await drive.writeAppDataJson('a.json', '{}');
    const second = await drive.writeAppDataJson('a.json', '{"v":2}', first.id);
    expect(second.id).toBe(first.id);
    expect(second.modifiedTime > first.modifiedTime).toBe(true);
    expect(await drive.readText(first.id)).toBe('{"v":2}');
    expect((await drive.listAppData()).length).toBe(1);
  });

  it('deleteFile on an unknown id resolves', async () => {
    await expect(drive.deleteFile('nope')).resolves.toBeUndefined();
  });

  it('exportState and importState round-trip a PDF blob byte-for-byte', async () => {
    const pdf = new Blob([new Uint8Array([37, 80, 68, 70, 0, 255, 10, 13])], { type: 'application/pdf' });
    const uploaded = await drive.uploadPdf(pdf, 'book.pdf', 'folder', 'book-1');
    const state = drive.exportState();

    const other = new FakeDrive();
    other.importState(state);
    const copy = await other.downloadBlob(uploaded.id);
    expect(await bytesOf(copy)).toEqual(await bytesOf(pdf));
  });

  it('failNext makes only the next call reject, with the given error', async () => {
    drive.failNext(new DriveAuthError('expired'));
    await expect(drive.listAppData()).rejects.toBeInstanceOf(DriveAuthError);
    await expect(drive.listAppData()).resolves.toEqual([]);
  });

  it('ensureBooksFolder creates Iqra/Books once and is idempotent', async () => {
    const first = await drive.ensureBooksFolder();
    const second = await drive.ensureBooksFolder();
    expect(second).toBe(first);
    expect(drive.folderNames()).toEqual(['Iqra', 'Books']);
  });

  it('uploadPdf stores the file with the bookId app property and reports full progress', async () => {
    const folderId = await drive.ensureBooksFolder();
    const progress: number[] = [];
    const info = await drive.uploadPdf(new Blob(['x']), 'book.pdf', folderId, 'book-1', (f) => progress.push(f));
    expect(info.appProperties).toEqual({ iqraBookId: 'book-1' });
    expect(info.size).toBe(1);
    expect(progress).toEqual([1]);
  });

  it('storageQuota reports 15 GiB limit and the sum of stored sizes', async () => {
    await drive.writeAppDataJson('a.json', '{}');
    await drive.uploadPdf(new Blob([new Uint8Array(10)]), 'b.pdf', 'f', 'book-1');
    expect(await drive.storageQuota()).toEqual({ limit: 15 * 1024 ** 3, usage: 12 });
  });

  it('mediaRequest points at the fake file url', () => {
    expect(drive.mediaRequest('file-9')).toEqual({ url: 'fake://file-9', httpHeaders: {} });
  });
});
