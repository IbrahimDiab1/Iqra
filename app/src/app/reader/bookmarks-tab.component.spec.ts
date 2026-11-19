import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationService } from '../annotations/annotation.service';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Annotation, Book, OutlineNode } from '../core/models';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
import { BookmarksTabComponent } from './bookmarks-tab.component';
import type { Place } from './jump-history';

const OUTLINE: OutlineNode[] = [
  { key: '0', title: 'Intro', page: 1, children: [] },
  { key: '1', title: 'Part Two', page: 20, children: [{ key: '1.0', title: 'Nested', page: 25, children: [] }] },
];

@Component({
  imports: [BookmarksTabComponent],
  template: `<iqra-bookmarks-tab [book]="book" [annotations]="annotations()" (jump)="jumps.push($event)" (done)="dones = dones + 1" />`,
})
class HostComponent {
  annotations = signal<Annotation[]>([]);
  book = { id: 'b1', pageCount: 40, outline: OUTLINE } as Book;
  dones = 0;
  jumps: Place[] = [];
}

describe('BookmarksTabComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;
  let db: IqraDb;

  function create(setup?: (h: HostComponent) => void) {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    setup?.(host);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  beforeEach(() => {
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [{ provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => 5000 } }],
    });
  });
  afterEach(async () => {
    fixture?.destroy();
    await db.delete();
  });

  const mark = (id: string, page: number): Annotation => ({
    id, bookId: 'b1', type: 'bookmark', page, tags: [], createdAt: page, updatedAt: 1, deviceId: 'd',
  });

  it('lists bookmarks by page with the chapter title; tapping jumps and reports done', () => {
    create((h) => h.annotations.set([mark('m30', 30), mark('m3', 3), mark('m0', 0)]));
    const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('.row.bm'));
    expect(rows.map((r) => [r.querySelector('.num')!.textContent, r.querySelector('.title')!.textContent])).toEqual([['p. 0', ''], ['p. 3', 'Intro'], ['p. 30', 'Nested']]);
    rows[1].click();
    expect(host.jumps).toEqual([{ page: 3, offset: 0 }]);
    expect(host.dones).toBe(1);
  });

  it('shows the empty state', () => {
    create();
    expect(el.textContent).toContain(COPY.annotations.noBookmarks);
  });

  it('the trash button removes with an Undo toast; Undo brings it back', async () => {
    const rec = await TestBed.inject(AnnotationService).create({ bookId: 'b1', type: 'bookmark', page: 3 });
    create((h) => h.annotations.set([rec]));
    el.querySelector<HTMLButtonElement>('button.tool')!.click();
    await vi.waitFor(async () => expect((await db.annotations.get(rec.id))?.deleted).toBe(true));
    const toast = TestBed.inject(ToastService);
    expect(toast.current()?.message).toBe(COPY.annotations.deleted);
    toast.undo();
    await vi.waitFor(async () => expect((await db.annotations.get(rec.id))?.deleted).toBeFalsy());
  });
});
