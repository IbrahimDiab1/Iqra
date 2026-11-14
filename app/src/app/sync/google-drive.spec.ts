import { vi } from 'vitest';
import { DriveAuthError, DriveTimeoutError } from './drive-adapter';
import { CHUNK_SIZE, GoogleDrive, TokenSource } from './google-drive';

const TOTAL = 20971520;
const SESSION = 'https://upload.example/session/abc';
const BASE = 'https://www.googleapis.com';

function tokens(token: string | null = 't1'): TokenSource {
  return { token: () => token };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function empty(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

/** Returns the queued responses in order; an Error entry is thrown instead of returned. */
function queueFetch(...queue: Array<Response | Error>) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch call');
    if (next instanceof Error) throw next;
    return next;
  });
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

describe('GoogleDrive', () => {
  it('listAppData sends the bearer token and maps files', async () => {
    const fetchFn = queueFetch(
      json({ files: [{ id: 'f1', name: 'a.json', modifiedTime: '2026-01-01T00:00:00.000Z', size: '12' }] }),
    );
    const drive = new GoogleDrive(tokens('t1'), fetchFn, vi.fn());

    const files = await drive.listAppData();

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain(`${BASE}/drive/v3/files?spaces=appDataFolder`);
    expect(headersOf(init)['Authorization']).toBe('Bearer t1');
    expect(files).toEqual([{ id: 'f1', name: 'a.json', modifiedTime: '2026-01-01T00:00:00.000Z', size: 12 }]);
  });

  it('a 401 response rejects with DriveAuthError', async () => {
    const drive = new GoogleDrive(tokens(), queueFetch(empty(401)), vi.fn());
    await expect(drive.listAppData()).rejects.toBeInstanceOf(DriveAuthError);
  });

  it('without a token it rejects with DriveAuthError and never calls fetch', async () => {
    const fetchFn = queueFetch();
    const drive = new GoogleDrive(tokens(null), fetchFn, vi.fn());

    await expect(drive.listAppData()).rejects.toBeInstanceOf(DriveAuthError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uploadPdf of 20 MiB sends three 8 MiB chunks and reports progress to 1', async () => {
    const fetchFn = queueFetch(
      empty(200, { Location: SESSION }),
      empty(308),
      empty(308),
      json({ id: 'pdf1', name: 'book.pdf', modifiedTime: '2026-01-01T00:00:00.000Z', size: TOTAL }),
    );
    const drive = new GoogleDrive(tokens(), fetchFn, vi.fn());
    const blob = new Blob([new Uint8Array(TOTAL)], { type: 'application/pdf' });
    const progress: number[] = [];

    const info = await drive.uploadPdf(blob, 'book.pdf', 'folder1', 'book-1', (f: number) => progress.push(f));

    expect(CHUNK_SIZE).toBe(8388608);
    const [, initPost] = fetchFn.mock.calls[0];
    expect(JSON.parse(initPost?.body as string)).toEqual({
      name: 'book.pdf',
      parents: ['folder1'],
      appProperties: { iqraBookId: 'book-1' },
    });
    const ranges = fetchFn.mock.calls.slice(1).map(([, init]) => headersOf(init)['Content-Range']);
    expect(ranges).toEqual([
      'bytes 0-8388607/20971520',
      'bytes 8388608-16777215/20971520',
      'bytes 16777216-20971519/20971520',
    ]);
    expect(progress.at(-1)).toBe(1);
    expect(info.id).toBe('pdf1');
  });

  it('a network error on a chunk asks for the committed range, waits 1 s, then resumes the chunk', async () => {
    const fetchFn = queueFetch(
      empty(200, { Location: SESSION }),
      empty(308),
      new TypeError('network down'),
      empty(308, { Range: 'bytes=0-8388607' }),
      empty(308),
      json({ id: 'pdf1', name: 'book.pdf', modifiedTime: '2026-01-01T00:00:00.000Z' }),
    );
    const sleep = vi.fn(() => Promise.resolve());
    const drive = new GoogleDrive(tokens(), fetchFn, sleep);
    const blob = new Blob([new Uint8Array(TOTAL)]);

    await drive.uploadPdf(blob, 'book.pdf', 'folder1', 'book-1');

    const ranges = fetchFn.mock.calls.slice(1).map(([, init]) => headersOf(init)['Content-Range']);
    expect(ranges).toEqual([
      'bytes 0-8388607/20971520',
      'bytes 8388608-16777215/20971520',
      `bytes */${TOTAL}`,
      'bytes 8388608-16777215/20971520',
      'bytes 16777216-20971519/20971520',
    ]);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('deleteFile resolves when Drive answers 404', async () => {
    const drive = new GoogleDrive(tokens(), queueFetch(empty(404)), vi.fn());
    await expect(drive.deleteFile('gone')).resolves.toBeUndefined();
  });

  it('ensureBooksFolder creates Iqra and then Books inside it when both are missing', async () => {
    const fetchFn = queueFetch(
      json({ files: [] }),
      json({ id: 'iqra1' }),
      json({ files: [] }),
      json({ id: 'books1' }),
    );
    const drive = new GoogleDrive(tokens(), fetchFn, vi.fn());

    await expect(drive.ensureBooksFolder()).resolves.toBe('books1');

    const booksQuery = new URL(String(fetchFn.mock.calls[2][0])).searchParams.get('q') ?? '';
    expect(booksQuery).toContain("name='Books'");
    expect(booksQuery).toContain("'iqra1' in parents");
  });

  it('writeAppDataJson creates a multipart upload in appDataFolder', async () => {
    const fetchFn = queueFetch(json({ id: 'n1', name: 'state.json', modifiedTime: '2026-01-01T00:00:00.000Z' }));
    const drive = new GoogleDrive(tokens(), fetchFn, vi.fn());

    await drive.writeAppDataJson('state.json', '{"a":1}');

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain(`${BASE}/upload/drive/v3/files?uploadType=multipart`);
    expect(init?.method).toBe('POST');
    expect(headersOf(init)['Content-Type']).toMatch(/^multipart\/related; boundary=/);
    const body = await (init?.body as Blob).text();
    expect(body).toContain('"parents":["appDataFolder"]');
    expect(body).toContain('{"a":1}');
  });

  it('mediaRequest returns the alt=media URL and bearer header', () => {
    const drive = new GoogleDrive(tokens('t1'), queueFetch(), vi.fn());
    expect(drive.mediaRequest('f9')).toEqual({
      url: `${BASE}/drive/v3/files/f9?alt=media`,
      httpHeaders: { Authorization: 'Bearer t1' },
    });
  });
});

describe('GoogleDrive deadlines', () => {
  it('fails a request that gets no answer within 60 seconds with a retryable timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
      const drive = new GoogleDrive(tokens('t1'), fetchFn, vi.fn());

      const pending = drive.listAppData();
      const assertion = expect(pending).rejects.toBeInstanceOf(DriveTimeoutError);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
