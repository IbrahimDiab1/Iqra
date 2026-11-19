import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Annotation, Book, Category, SyncRecord } from '../core/models';
import { Repo } from '../core/repo';
import { SyncEngine } from '../sync/sync-engine';
import { ToastService } from '../ui/toast.service';
import { buildBackup } from '../data/backup';
import { DataSection } from './data.section';

function book(id: string, title: string, updatedAt = 1): Book {
  return {
    id, deviceId: 'dev', updatedAt, title, author: 'A', driveFileId: 'd', fileName: `${id}.pdf`, sizeBytes: 1,
    sha256: id, pageCount: 10, outline: [], language: 'en', direction: 'ltr', addedAt: 1, status: 'reading',
    categoryIds: [], tags: [], progressMode: 'last-page', pageMode: 'swipe', lastPageReached: 0,
  };
}
const highlight = (id: string, bookId: string): Annotation => ({
  id, deviceId: 'dev', updatedAt: 1, bookId, type: 'highlight', page: 1, tags: [], createdAt: 1,
  text: { page: 1, quote: 'q', start: { item: 0, offset: 0 }, end: { item: 0, offset: 1 }, rects: [] },
});
const sr = (...xs: object[]) => xs as unknown as SyncRecord[];
const cat = (id: string, name: string, updatedAt: number): Category => ({ id, name, order: 0, updatedAt, deviceId: 'dev' });

describe('DataSection', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<DataSection>;
  let el: HTMLElement;
  let toast: ToastService;
  let saved: { name: string; blob: Blob }[];
  const syncNow = vi.fn(async () => undefined);
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel);
  const sheetOpen = () => q('[role="dialog"]')!.getAttribute('aria-hidden') === null;
  async function settle(check: () => void | Promise<void>): Promise<void> {
    await vi.waitFor(async () => {
      fixture.detectChanges();
      await check();
    });
  }
  async function pick(text: string): Promise<void> {
    const input = q<HTMLInputElement>('[data-testid="restore-input"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'backup.json', { type: 'application/json' })] });
    input.dispatchEvent(new Event('change'));
  }

  beforeEach(async () => {
    localStorage.clear();
    saved = [];
    syncNow.mockClear();
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      saved.push({ name: '', blob: blob as Blob });
      return `blob:fake-${saved.length}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved[saved.length - 1].name = this.download;
    });
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => new Date(2026, 10, 19, 12).getTime() } },
        { provide: SyncEngine, useValue: { syncNow, status: signal('synced') } },
      ],
    });
    toast = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(DataSection);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    await db.delete();
  });

  it('exports notes as a dated zip', async () => {
    await db.books.bulkPut([book('b1', 'Dune')]);
    await db.annotations.bulkPut([highlight('a1', 'b1')]);
    q<HTMLButtonElement>('[data-testid="export-notes"]')!.click();
    await settle(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('iqra-notes-2026-11-19.zip');
    const bytes = new Uint8Array(await saved[0].blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('says so when there are no notes to export, and downloads nothing', async () => {
    await db.books.bulkPut([book('b1', 'Dune')]);
    q<HTMLButtonElement>('[data-testid="export-notes"]')!.click();
    await settle(() => expect(toast.current()?.message).toContain('No notes'));
    expect(saved).toHaveLength(0);
  });

  it('backs up every table, tombstones included, as a dated JSON file', async () => {
    await db.books.bulkPut([book('b1', 'Dune'), { ...book('b2', 'Old'), deleted: true }]);
    await db.categories.put(cat('c1', 'Fiqh', 1));
    q<HTMLButtonElement>('[data-testid="backup"]')!.click();
    await settle(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('iqra-backup-2026-11-19.json');
    const doc = JSON.parse(await saved[0].blob.text());
    expect(doc.schemaVersion).toBe(1);
    expect(doc.tables.books.map((b: Book) => b.id).sort()).toEqual(['b1', 'b2']);
    expect(doc.tables.categories).toHaveLength(1);
  });

  it('shows counts in a confirm sheet and changes nothing until confirmed', async () => {
    const text = JSON.stringify(buildBackup({ books: sr(book('b1', 'A'), book('b2', 'B')), annotations: sr(highlight('a1', 'b1')) }, 1));
    await pick(text);
    await settle(() => expect(sheetOpen()).toBe(true));
    const body = el.textContent!.replace(/\s+/g, ' ');
    expect(body).toContain('2 books');
    expect(body).toContain('1 annotation');
    expect(body).toContain('newer data on this device is kept');
    expect(await db.books.count()).toBe(0);
    q<HTMLButtonElement>('[data-testid="cancel-restore"]')!.click();
    fixture.detectChanges();
    expect(await db.books.count()).toBe(0);
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('restores missing records, keeps newer local ones, and syncs', async () => {
    await db.categories.put(cat('c1', 'Local newer', 50));
    await db.categories.put(cat('c2', 'Local older', 5));
    const text = JSON.stringify(buildBackup({ categories: sr(cat('c1', 'Backup older', 10), cat('c2', 'Backup newer', 20), cat('c3', 'Only backup', 1)), books: sr(book('b1', 'Dune')) }, 1));
    await pick(text);
    await settle(() => expect(sheetOpen()).toBe(true));
    q<HTMLButtonElement>('[data-testid="confirm-restore"]')!.click();
    await settle(() => expect(syncNow).toHaveBeenCalledTimes(1));
    expect((await db.categories.get('c1'))!.name).toBe('Local newer');
    expect((await db.categories.get('c2'))!.name).toBe('Backup newer');
    expect((await db.categories.get('c3'))!.name).toBe('Only backup');
    expect((await db.books.get('b1'))!.title).toBe('Dune');
    // restored records are queued for upload
    expect((await db.syncState.get('library.json'))!.dirty).toBe(true);
  });

  it('shows an error and changes nothing for a bad file', async () => {
    await db.categories.put(cat('c1', 'Keep', 5));
    for (const text of ['not json', JSON.stringify({ schemaVersion: 9, tables: {} }), JSON.stringify({ schemaVersion: 1, tables: { books: [{ id: 'x' }] } })]) {
      await pick(text);
      await settle(() => expect(q('[data-testid="restore-error"]')).not.toBeNull());
      expect(sheetOpen()).toBe(false);
    }
    expect(await db.books.count()).toBe(0);
    expect((await db.categories.get('c1'))!.name).toBe('Keep');
    expect(syncNow).not.toHaveBeenCalled();
  });

  it('refuses a file over 50 MB without reading it', async () => {
    const input = q<HTMLInputElement>('[data-testid="restore-input"]')!;
    const big = new File(['x'], 'big.json');
    Object.defineProperty(big, 'size', { value: 60 * 1024 * 1024 });
    const readSpy = vi.spyOn(big, 'text');
    Object.defineProperty(input, 'files', { configurable: true, value: [big] });
    input.dispatchEvent(new Event('change'));
    await settle(() => expect(q('[data-testid="restore-error"]')).not.toBeNull());
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('a failed write leaves tables unchanged and shows an error', async () => {
    await db.categories.put(cat('c1', 'Keep', 5));
    const text = JSON.stringify(buildBackup({ categories: sr(cat('c9', 'New', 1)), books: sr(book('b1', 'Dune')) }, 1));
    await pick(text);
    await settle(() => expect(sheetOpen()).toBe(true));
    const repo = TestBed.inject(Repo);
    const real = repo.applyRemote.bind(repo);
    // books are written first; the failure on the next table must undo them
    vi.spyOn(repo, 'applyRemote').mockImplementation(async (table, recs) => {
      if (table === 'categories') throw new Error('disk full');
      return real(table, recs);
    });
    q<HTMLButtonElement>('[data-testid="confirm-restore"]')!.click();
    await settle(() => expect(q('[data-testid="restore-error"]')).not.toBeNull());
    expect(await db.categories.get('c9')).toBeUndefined();
    expect(await db.books.get('b1')).toBeUndefined();
    expect(await db.syncState.count()).toBe(0);
    expect(syncNow).not.toHaveBeenCalled();
  });
});
