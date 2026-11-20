import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesService } from '../books/files.service';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Book } from '../core/models';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { StorageSection } from './storage.section';

function book(id: string, sizeBytes: number, deleted = false): Book {
  return {
    id, deviceId: 'dev', updatedAt: 1, title: `Book ${id}`, author: 'A', driveFileId: 'd', fileName: `${id}.pdf`, sizeBytes,
    sha256: id, pageCount: 10, outline: [], language: 'en', direction: 'ltr', addedAt: 1, status: 'reading',
    categoryIds: [], tags: [], progressMode: 'last-page', pageMode: 'swipe', lastPageReached: 0, deleted,
  };
}

describe('StorageSection', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<StorageSection>;
  let el: HTMLElement;
  const quota = vi.fn();
  const downloaded = signal(new Set<string>());
  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel);
  const text = () => el.textContent!.replace(/\s+/g, ' ');
  async function settle(check: () => void): Promise<void> {
    await vi.waitFor(() => {
      fixture.detectChanges();
      check();
    });
  }
  function setEstimate(value: unknown): void {
    Object.defineProperty(navigator, 'storage', { configurable: true, value });
  }

  beforeEach(async () => {
    db = new IqraDb(`iqra-test-${newId()}`);
    quota.mockReset();
    downloaded.set(new Set());
    setEstimate({ estimate: async () => ({ usage: 3_000_000, quota: 100_000_000 }) });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: DB, useValue: db },
        { provide: DRIVE_ADAPTER, useValue: { storageQuota: quota } },
        { provide: FilesService, useValue: { downloaded } },
      ],
    });
    await db.books.bulkPut([book('b1', 2_000_000), book('b2', 1_000_000), book('b3', 9_000_000, true)]);
  });

  afterEach(async () => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  function create(): void {
    fixture = TestBed.createComponent(StorageSection);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  it('shows a loading state, then the Drive bar with books, other and free', async () => {
    quota.mockReturnValue(new Promise(() => undefined));
    create();
    expect(q('[data-testid="drive-loading"]')).not.toBeNull();

    fixture.destroy();
    quota.mockResolvedValue({ limit: 15e9, usage: 5e9 });
    create();
    await settle(() => expect(q('[data-testid="drive-legend"]')).not.toBeNull());
    const legend = q('[data-testid="drive-legend"]')!.textContent!.replace(/\s+/g, ' ');
    expect(legend).toContain('Books');
    expect(legend).toContain('2.9 MB');
    expect(legend).toContain('Free');
    expect(q('[data-testid="drive-loading"]')).toBeNull();
    // The deleted book is not counted.
    expect(legend).not.toContain('11');
  });

  it('shows unlimited Drive storage without a Free segment', async () => {
    quota.mockResolvedValue({ limit: Infinity, usage: 5e6 });
    create();
    await settle(() => expect(q('[data-testid="drive-legend"]')).not.toBeNull());
    expect(q('[data-testid="drive-legend"]')!.textContent).not.toContain('Free');
  });

  it('shows an error with Retry, and Retry loads the data', async () => {
    quota.mockRejectedValueOnce(new Error('offline'));
    quota.mockResolvedValue({ limit: 100e6, usage: 10e6 });
    create();
    await settle(() => expect(q('[data-testid="drive-error"]')).not.toBeNull());
    expect(text()).toContain("Couldn't load Drive usage");
    q<HTMLButtonElement>('[data-testid="retry"]')!.click();
    await settle(() => expect(q('[data-testid="drive-legend"]')).not.toBeNull());
    expect(q('[data-testid="drive-error"]')).toBeNull();
  });

  it('shows device usage from the browser estimate and the size of downloaded books', async () => {
    quota.mockResolvedValue({ limit: 100e6, usage: 10e6 });
    downloaded.set(new Set(['b1']));
    create();
    await settle(() => expect(q('[data-testid="device-legend"]')!.textContent).toContain('1.9 MB'));
    const legend = q('[data-testid="device-legend"]')!.textContent!;
    expect(legend).toContain('Downloads');
    expect(legend).toContain('Other app data');
  });

  it('copes with an unavailable storage estimate and zero books', async () => {
    setEstimate(undefined);
    await db.books.clear();
    quota.mockResolvedValue({ limit: 100e6, usage: 0 });
    create();
    await settle(() => expect(q('[data-testid="drive-loading"]')).toBeNull());
    expect(text()).not.toMatch(/NaN|undefined|-\d/);
    expect(text()).toContain('0 B');
  });

  it('links to Manage downloads', async () => {
    quota.mockResolvedValue({ limit: 100e6, usage: 10e6 });
    create();
    await settle(() => expect(q('a[data-testid="manage-downloads"]')).not.toBeNull());
    expect(q('a[data-testid="manage-downloads"]')!.getAttribute('href')).toBe('/profile/downloads');
  });
});
