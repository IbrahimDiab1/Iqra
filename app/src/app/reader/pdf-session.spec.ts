import { PdfSession, ReaderOpenError, setPdfjsLoaderForTests } from './pdf-session';

interface Calls {
  getDocument: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  getViewport: ReturnType<typeof vi.fn>;
  getPage: ReturnType<typeof vi.fn>;
  getTextContent: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function install(failWith?: unknown): Calls {
  const cancel = vi.fn();
  // Like pdf.js, cancelling rejects the task's promise.
  const render = vi.fn(() => {
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((_, rej) => (reject = rej));
    return { promise, cancel: cancel.mockImplementation(() => reject({ name: 'RenderingCancelledException' })) };
  });
  const getViewport = vi.fn(({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }));
  const getTextContent = vi.fn(async () => ({ items: [{ str: 'hello world', transform: [1, 0, 0, 1, 0, 0], width: 1, height: 1 }] }));
  const page = { getViewport, render, getTextContent };
  const getPage = vi.fn(async () => page);
  const destroy = vi.fn(async () => undefined);
  const getDocument = vi.fn(() => ({
    promise: failWith === undefined ? Promise.resolve({ numPages: 3, getPage }) : Promise.reject(failWith),
    destroy,
  }));
  setPdfjsLoaderForTests(async () => ({ getDocument }) as never);
  return { getDocument, render, cancel, getViewport, getPage, getTextContent, destroy };
}

const local = () => ({ kind: 'local' as const, blob: new Blob([new Uint8Array([1, 2, 3])]) });

describe('PdfSession', () => {
  afterEach(() => setPdfjsLoaderForTests(undefined));

  it('opens a local blob with data', async () => {
    const c = install();
    const s = await PdfSession.open(local());
    expect(s.numPages).toBe(3);
    const arg = c.getDocument.mock.calls[0][0];
    expect(arg.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(arg.data)).toEqual([1, 2, 3]);
  });

  it('opens a drive source with range options', async () => {
    const c = install();
    await PdfSession.open({ kind: 'drive', url: 'https://x/y', httpHeaders: { Authorization: 'Bearer t' } });
    expect(c.getDocument.mock.calls[0][0]).toEqual({
      url: 'https://x/y',
      httpHeaders: { Authorization: 'Bearer t' },
      rangeChunkSize: 65536,
      disableAutoFetch: true,
    });
  });

  it('maps open failures to reasons', async () => {
    install({ name: 'PasswordException' });
    await expect(PdfSession.open(local())).rejects.toMatchObject({ reason: 'password' });
    install({ name: 'InvalidPDFException' });
    await expect(PdfSession.open(local())).rejects.toMatchObject({ reason: 'corrupt' });
    install({ name: 'MissingPDFException' });
    await expect(PdfSession.open(local())).rejects.toMatchObject({ reason: 'corrupt' });
    install({ name: 'FormatError' });
    await expect(PdfSession.open(local())).rejects.toMatchObject({ reason: 'corrupt' });
    install(new TypeError('Failed to fetch'));
    const err = await PdfSession.open(local()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReaderOpenError);
    expect((err as ReaderOpenError).reason).toBe('network');
    install({ name: 'UnexpectedResponseException' });
    await expect(PdfSession.open(local())).rejects.toMatchObject({ reason: 'network' });
  });

  it('fetches a page size once per page', async () => {
    const c = install();
    const s = await PdfSession.open(local());
    expect(await s.pageSize(2)).toEqual({ widthPt: 600, heightPt: 800 });
    await s.pageSize(2);
    await Promise.all([s.pageSize(2), s.pageSize(2)]);
    expect(c.getViewport).toHaveBeenCalledTimes(1);
    expect(c.getPage).toHaveBeenCalledTimes(1);
  });

  it('does not render with an already-aborted signal', async () => {
    const c = install();
    const s = await PdfSession.open(local());
    const ac = new AbortController();
    ac.abort();
    const canvas = document.createElement('canvas');
    await expect(s.renderPage(1, canvas, 300, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(c.render).not.toHaveBeenCalled();
  });

  it('cancels the render task when aborted mid-render', async () => {
    const c = install();
    const s = await PdfSession.open(local());
    const ac = new AbortController();
    const canvas = { width: 0, height: 0, getContext: () => ({}) } as unknown as HTMLCanvasElement;
    const p = s.renderPage(1, canvas, 300, ac.signal);
    const settled = p.catch((e: unknown) => e);
    await vi.waitFor(() => expect(c.render).toHaveBeenCalled());
    expect(canvas.width).toBeGreaterThan(0);
    ac.abort();
    expect(c.cancel).toHaveBeenCalled();
    expect(await settled).toMatchObject({ name: 'AbortError' });
  });

  it('caches page text', async () => {
    const c = install();
    const s = await PdfSession.open(local());
    expect(await s.pageText(1)).toBe('hello world');
    await s.pageText(1);
    expect(c.getTextContent).toHaveBeenCalledTimes(1);
  });

  it('destroy destroys the document', async () => {
    const c = install();
    const s = await PdfSession.open(local());
    s.destroy();
    expect(c.destroy).toHaveBeenCalled();
  });
});
