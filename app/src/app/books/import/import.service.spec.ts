import { TestBed } from '@angular/core/testing';
import { AuthApi } from '../../auth/auth.service';
import { FakeAuthService } from '../../auth/fake-auth.service';
import { CLOCK } from '../../core/clock';
import { DB, IqraDb } from '../../core/db';
import { newId } from '../../core/ids';
import { DRIVE_ADAPTER } from '../../sync/drive-adapter';
import { FakeDrive } from '../../sync/fake-drive';
import { COPY } from '../../ui/copy';
import { ToastService } from '../../ui/toast.service';
import { PDF_INSPECTOR, ImportService, type PdfInspector } from './import.service';
import { UnreadablePdfError } from './pdf-meta';

function pdf(name: string, content: string): File {
  return new File([content], name, { type: 'application/pdf' });
}

describe('ImportService', () => {
  let service: ImportService;
  let db: IqraDb;
  let toast: ToastService;
  let inspector: { readMeta: ReturnType<typeof vi.fn>; renderCover: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    inspector = {
      readMeta: vi.fn(async () => ({
        pageCount: 10,
        title: '',
        author: 'Author',
        outline: [],
        language: 'en' as const,
      })),
      renderCover: vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' })),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useFactory: () => new IqraDb(`iqra-test-${newId()}`) },
        { provide: CLOCK, useValue: { now: () => 1000 } },
        { provide: PDF_INSPECTOR, useValue: inspector as PdfInspector },
        { provide: DRIVE_ADAPTER, useValue: new FakeDrive() },
        { provide: AuthApi, useClass: FakeAuthService },
      ],
    });
    service = TestBed.inject(ImportService);
    db = TestBed.inject(DB);
    toast = TestBed.inject(ToastService);
    vi.spyOn(toast, 'show');
  });

  afterEach(async () => {
    await db.delete();
  });

  it('skips an unreadable file, toasts it, and still imports the rest in order', async () => {
    inspector.readMeta.mockImplementation(async (blob: Blob) => {
      if ((blob as File).name === 'broken.pdf') throw new UnreadablePdfError();
      return { pageCount: 3, title: '', author: '', outline: [], language: 'en' };
    });

    const result = await service.importFiles([pdf('good.pdf', 'a'), pdf('broken.pdf', 'b'), pdf('good2.pdf', 'c')]);

    expect(result.added).toHaveLength(2);
    expect(result.skipped).toEqual(['broken.pdf']);
    expect(toast.show).toHaveBeenCalledTimes(1);
    expect(toast.show).toHaveBeenCalledWith(expect.stringContaining("broken.pdf couldn't be added"));
    expect(toast.show).toHaveBeenCalledWith(expect.stringContaining(COPY.import.added(2)));
    const titles = (await db.books.toArray()).map((b) => b.fileName).sort();
    expect(titles).toEqual(['good.pdf', 'good2.pdf']);
  });

  it('names every failed file in one toast when several fail', async () => {
    inspector.readMeta.mockImplementation(async (blob: Blob) => {
      if ((blob as File).name.startsWith('b')) throw new UnreadablePdfError();
      return { pageCount: 3, title: '', author: '', outline: [], language: 'en' };
    });

    await service.importFiles([pdf('b1.pdf', 'a'), pdf('b2.pdf', 'b'), pdf('g.pdf', 'c')]);

    expect(toast.show).toHaveBeenLastCalledWith("Book added. 2 files couldn't be added: b1.pdf, b2.pdf.");
  });

  it('skips a second import of the same content as a duplicate', async () => {
    const first = await service.importFiles([pdf('one.pdf', 'same bytes')]);
    const second = await service.importFiles([pdf('copy.pdf', 'same bytes')]);

    expect(first.added).toHaveLength(1);
    expect(second.added).toHaveLength(0);
    expect(second.skipped).toEqual(['copy.pdf']);
    expect(toast.show).toHaveBeenCalledWith(COPY.import.duplicate('copy.pdf'));
    expect(await db.books.count()).toBe(1);
  });

  it('ignores deleted books when checking for duplicates', async () => {
    const first = await service.importFiles([pdf('one.pdf', 'bytes')]);
    const book = await db.books.get(first.added[0]);
    await db.books.put({ ...book!, deleted: true });

    const again = await service.importFiles([pdf('one.pdf', 'bytes')]);

    expect(again.added).toHaveLength(1);
  });

  it('stores the book, its PDF, its cover and two pending uploads', async () => {
    inspector.readMeta.mockResolvedValue({
      pageCount: 7,
      title: 'Thinking in Systems',
      author: 'Donella Meadows',
      outline: [{ key: '0', title: 'Ch1', page: 2, children: [] }],
      language: 'ar',
    });
    const file = pdf('systems.pdf', 'content');

    const [id] = (await service.importFiles([file])).added;

    const book = await db.books.get(id);
    expect(book).toMatchObject({
      title: 'Thinking in Systems',
      author: 'Donella Meadows',
      driveFileId: '',
      fileName: 'systems.pdf',
      sizeBytes: file.size,
      pageCount: 7,
      language: 'ar',
      direction: 'rtl',
      status: 'to-read',
      addedAt: 1000,
      lastPageReached: 0,
      progressMode: 'last-page',
      pageMode: 'swipe',
      categoryIds: [],
      tags: [],
      updatedAt: 1000,
    });
    expect(book?.outline).toEqual([{ key: '0', title: 'Ch1', page: 2, children: [] }]);
    expect(book?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await db.pdfFiles.get(id))?.sizeBytes).toBe(file.size);
    expect(await db.covers.get(id)).toBeDefined();
    const uploads = await db.pendingUploads.where('bookId').equals(id).toArray();
    expect(uploads.map((u) => u.kind).sort()).toEqual(['cover', 'pdf']);
  });

  it('uses the settings defaults for progress and page mode', async () => {
    await db.settings.put({
      id: 'settings',
      updatedAt: 1,
      deviceId: 'd',
      defaultProgressMode: 'marked',
      defaultPageMode: 'scroll',
      defaultView: 'page',
      readerTheme: 'paper',
      weekStartsOn: 6,
      reminders: {},
      cardDirection: 'mixed',
    });

    const [id] = (await service.importFiles([pdf('a.pdf', 'x')])).added;

    expect(await db.books.get(id)).toMatchObject({ progressMode: 'marked', pageMode: 'scroll' });
  });

  it('shows the added toast with the count', async () => {
    await service.importFiles([pdf('a.pdf', '1'), pdf('b.pdf', '2')]);

    expect(toast.show).toHaveBeenLastCalledWith(COPY.import.added(2));
  });
});
