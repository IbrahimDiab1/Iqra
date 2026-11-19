import { PdfSession, ReaderOpenError, setCanvasFactoryForTests, setPdfjsLoaderForTests } from './pdf-session';

interface Calls {
  getDocument: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  getViewport: ReturnType<typeof vi.fn>;
  getPage: ReturnType<typeof vi.fn>;
  getTextContent: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
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
  const cleanup = vi.fn(() => true);
  const page = { getViewport, render, getTextContent, cleanup };
  const getPage = vi.fn(async () => page);
  const destroy = vi.fn(async () => undefined);
  const getDocument = vi.fn(() => ({
    promise: failWith === undefined ? Promise.resolve({ numPages: 3, getPage }) : Promise.reject(failWith),
    destroy,
  }));
  setPdfjsLoaderForTests(async () => ({ getDocument }) as never);
  return { getDocument, render, cancel, getViewport, getPage, getTextContent, destroy, cleanup };
}

const local = () => ({ kind: 'local' as const, blob: new Blob([new Uint8Array([1, 2, 3])]) });

describe('PdfSession', () => {
  afterEach(() => {
    setPdfjsLoaderForTests(undefined);
    setCanvasFactoryForTests(undefined);
  });

  function fakeCanvas(w = 0, h = 0) {
    const ctx = { drawImage: vi.fn(), clearRect: vi.fn() };
    const c = { width: w, height: h, getContext: vi.fn(() => ctx) };
    return { c: c as unknown as HTMLCanvasElement, ctx, raw: c };
  }

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
    const err = await PdfSession.open({ kind: 'drive', url: 'u', httpHeaders: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReaderOpenError);
    expect((err as ReaderOpenError).reason).toBe('network');
  });

  it('maps pdf.js 6.5 failure shapes', async () => {
    const drive = { kind: 'drive' as const, url: 'u', httpHeaders: {} };
    install({ name: 'ResponseException', status: 404, missing: true });
    await expect(PdfSession.open(drive)).rejects.toMatchObject({ reason: 'corrupt' });
    install({ name: 'ResponseException', status: 503, missing: false });
    await expect(PdfSession.open(drive)).rejects.toMatchObject({ reason: 'network' });
    install(new TypeError('Failed to fetch'));
    await expect(PdfSession.open(drive)).rejects.toMatchObject({ reason: 'network' });
    install({ name: 'UnknownErrorException' });
    await expect(PdfSession.open(drive)).rejects.toMatchObject({ reason: 'network' });
    // A local blob cannot fail by network: a wrapped worker FormatError is corrupt.
    install({ name: 'UnknownErrorException' });
    await expect(PdfSession.open(local())).rejects.toMatchObject({ reason: 'corrupt' });
    install({ name: 'ResponseException', status: 500, missing: false });
    await expect(PdfSession.open(local())).rejects.toMatchObject({ reason: 'corrupt' });
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

  it('cleans up the page once after a render, whether it succeeds, fails or is aborted', async () => {
    const c = install();
    const s = await PdfSession.open(local());
    setCanvasFactoryForTests(() => fakeCanvas().c);
    c.render.mockImplementationOnce(() => ({ promise: Promise.resolve(), cancel: c.cancel }));
    await s.renderPage(1, fakeCanvas(10, 10).c, 300, new AbortController().signal);
    expect(c.cleanup).toHaveBeenCalledTimes(1);

    c.render.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('boom')), cancel: c.cancel }));
    await expect(s.renderPage(1, fakeCanvas(10, 10).c, 300, new AbortController().signal)).rejects.toThrow('boom');
    expect(c.cleanup).toHaveBeenCalledTimes(2);

    const ac = new AbortController();
    const pending = s.renderPage(1, fakeCanvas(10, 10).c, 300, ac.signal).catch((e: unknown) => e);
    await vi.waitFor(() => expect(c.render).toHaveBeenCalledTimes(3));
    ac.abort();
    await pending;
    expect(c.cleanup).toHaveBeenCalledTimes(3);
  });

  it('cleans up the page after extracting its text', async () => {
    const c = install();
    const s = await PdfSession.open(local());
    await s.textItems(1);
    expect(c.cleanup).toHaveBeenCalledTimes(1);
  });

  it('cancels the render task when aborted mid-render', async () => {
    const c = install();
    const s = await PdfSession.open(local());
    const ac = new AbortController();
    const work = fakeCanvas();
    setCanvasFactoryForTests(() => work.c);
    const visible = fakeCanvas(10, 10);
    const settled = s.renderPage(1, visible.c, 300, ac.signal).catch((e: unknown) => e);
    await vi.waitFor(() => expect(c.render).toHaveBeenCalled());
    ac.abort();
    expect(c.cancel).toHaveBeenCalled();
    expect(await settled).toMatchObject({ name: 'AbortError' });
    expect(visible.ctx.drawImage).not.toHaveBeenCalled();
    expect(visible.raw.width).toBe(10);
  });

  it('leaves the visible canvas untouched until the render finishes, then draws in one step', async () => {
    const c = install();
    c.render.mockImplementation(() => {
      let done!: () => void;
      const promise = new Promise<void>((r) => (done = r));
      finish = done;
      return { promise, cancel: c.cancel };
    });
    let finish!: () => void;
    const s = await PdfSession.open(local());
    const work = fakeCanvas();
    setCanvasFactoryForTests(() => work.c);
    const visible = fakeCanvas(50, 60);
    const p = s.renderPage(1, visible.c, 300, new AbortController().signal);
    await vi.waitFor(() => expect(c.render).toHaveBeenCalled());
    expect(work.raw.width).toBeGreaterThan(0);
    expect(visible.raw.width).toBe(50);
    expect(visible.raw.height).toBe(60);
    expect(visible.ctx.drawImage).not.toHaveBeenCalled();
    const target = work.raw.width;
    finish();
    await p;
    expect(visible.raw.width).toBe(target);
    expect(visible.ctx.drawImage).toHaveBeenCalledWith(work.c, 0, 0);
  });

  it('caches page text', async () => {
    const c = install();
    const s = await PdfSession.open(local());
    expect(await s.pageText(1)).toBe('hello world');
    await s.pageText(1);
    expect(c.getTextContent).toHaveBeenCalledTimes(1);
  });

  it('hands out the text items of a right-to-left line in reading order, and the page text follows', async () => {
    const c = install();
    const at = (str: string, x: number, hasEOL = false) => ({ str, transform: [22, 0, 0, 22, x, 500], width: 40, height: 22, hasEOL });
    // A PDF that draws its words left to right: القراءة غذاء العقل
    c.getTextContent.mockResolvedValue({ items: [at('العقل', 10), at('غذاء', 60), at('القراءة', 110, true)] });
    const s = await PdfSession.open(local());
    expect((await s.textItems(1)).map((i) => i.str)).toEqual(['القراءة', 'غذاء', 'العقل']);
    expect(await s.pageText(1)).toBe('القراءة غذاء العقل');
  });

  it('destroy destroys the document', async () => {
    const c = install();
    const s = await PdfSession.open(local());
    s.destroy();
    expect(c.destroy).toHaveBeenCalled();
  });
});
