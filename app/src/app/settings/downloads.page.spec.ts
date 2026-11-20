import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../app.routes';
import { signedInGuard } from '../auth/auth.guard';
import { FilesService } from '../books/files.service';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Book } from '../core/models';
import { DownloadsPage } from './downloads.page';

function book(id: string, sizeBytes: number, extra: Partial<Book> = {}): Book {
  return {
    id, deviceId: 'dev', updatedAt: 1, title: `Book ${id}`, author: 'A', driveFileId: 'd', fileName: `${id}.pdf`, sizeBytes,
    sha256: id, pageCount: 10, outline: [], language: 'en', direction: 'ltr', addedAt: 1, status: 'reading',
    categoryIds: [], tags: [], progressMode: 'last-page', pageMode: 'swipe', lastPageReached: 0, ...extra,
  };
}

describe('downloads route', () => {
  it('is lazy and behind the signed-in guard', () => {
    const route = routes.find((r) => r.path === 'profile/downloads')!;
    expect(route.component).toBeUndefined();
    expect(typeof route.loadComponent).toBe('function');
    expect(route.canActivate).toEqual([signedInGuard]);
  });
});

describe('DownloadsPage', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<DownloadsPage>;
  let el: HTMLElement;
  const downloaded = signal(new Set<string>());
  const removeLocal = vi.fn(async (_b: Book) => undefined);
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const titles = () => Array.from(el.querySelectorAll('[data-testid="dl-title"]')).map((n) => n.textContent!.trim());
  async function settle(check: () => void): Promise<void> {
    await vi.waitFor(() => {
      fixture.detectChanges();
      check();
    });
  }

  beforeEach(async () => {
    localStorage.clear();
    removeLocal.mockClear();
    db = new IqraDb(`iqra-test-${newId()}`);
    downloaded.set(new Set(['small', 'big', 'mid', 'pending']));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: DB, useValue: db }, { provide: FilesService, useValue: { downloaded, removeLocal } }],
    });
    await db.books.bulkPut([
      book('small', 1_000_000, { lastOpenedAt: Date.UTC(2026, 0, 5) }),
      book('big', 9_000_000),
      book('mid', 4_000_000),
      book('gone', 7_000_000), // not downloaded
      book('pending', 100, { driveFileId: '' }),
    ]);
    fixture = TestBed.createComponent(DownloadsPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('lists downloaded books by size, largest first, with the total', async () => {
    await settle(() => expect(titles().length).toBe(4));
    expect(titles()).toEqual(['Book big', 'Book mid', 'Book small', 'Book pending']);
    expect(q('[data-testid="dl-total"]').textContent).toContain('13 MB');
    expect(q('[data-testid="dl-title"]').getAttribute('dir')).toBe('auto');
  });

  it('removes one download through FilesService', async () => {
    await settle(() => expect(titles().length).toBe(4));
    q<HTMLButtonElement>('[data-book="mid"] [data-testid="dl-remove"]').click();
    expect(removeLocal).toHaveBeenCalledTimes(1);
    expect(removeLocal.mock.calls[0][0].id).toBe('mid');
  });

  it('saves a copy of the cached PDF to the device with an anchor download, and says so', async () => {
    await db.pdfFiles.put({ bookId: 'mid', blob: new Blob(['%PDF-1.4 mid']), sizeBytes: 12, savedAt: 1 });
    await settle(() => expect(titles().length).toBe(4));
    expect(el.textContent).toContain('Downloads folder');
    const create = vi.fn(() => 'blob:mid');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    let saved: { name: string; href: string } | null = null;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved = { name: this.download, href: this.href };
    });
    q<HTMLButtonElement>('[data-book="mid"] [data-testid="dl-save"]').click();
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    expect(saved).toEqual({ name: 'mid.pdf', href: 'blob:mid' });
    expect(removeLocal).not.toHaveBeenCalled();
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('asks before removing all, then removes every uploaded download', async () => {
    await settle(() => expect(titles().length).toBe(4));
    q<HTMLButtonElement>('[data-testid="remove-all"]').click();
    fixture.detectChanges();
    expect(removeLocal).not.toHaveBeenCalled();
    q<HTMLButtonElement>('[data-testid="confirm-remove-all"]').click();
    await settle(() => expect(removeLocal).toHaveBeenCalledTimes(3));
    expect(removeLocal.mock.calls.map((c) => c[0].id).sort()).toEqual(['big', 'mid', 'small']);
  });

  it('cancelling the confirm sheet removes nothing', async () => {
    await settle(() => expect(titles().length).toBe(4));
    q<HTMLButtonElement>('[data-testid="remove-all"]').click();
    fixture.detectChanges();
    q<HTMLButtonElement>('[data-testid="cancel-remove-all"]').click();
    fixture.detectChanges();
    expect(removeLocal).not.toHaveBeenCalled();
  });

  it('shows an empty state', async () => {
    downloaded.set(new Set());
    await settle(() => expect(q('[data-testid="dl-empty"]')).not.toBeNull());
    expect(q('[data-testid="dl-empty"]').textContent).toContain('No books are downloaded on this device.');
    expect(el.querySelector('[data-testid="remove-all"]')).toBeNull();
  });
});
