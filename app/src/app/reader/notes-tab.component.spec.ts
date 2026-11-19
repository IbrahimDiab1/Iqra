import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Annotation, Book, OutlineNode, SummaryScope } from '../core/models';
import { COPY } from '../ui/copy';
import type { Place } from './jump-history';
import { NotesTabComponent, type NotesFilter } from './notes-tab.component';

const OUTLINE: OutlineNode[] = [
  { key: '0', title: 'Intro', page: 1, children: [] },
  { key: '1', title: 'Part Two', page: 20, children: [{ key: '1.0', title: 'Nested', page: 25, children: [] }] },
];

@Component({
  imports: [NotesTabComponent],
  template: `<iqra-notes-tab
    [book]="book"
    [page]="page()"
    [annotations]="annotations()"
    [filter]="filter()"
    (filterChange)="filter.set($event)"
    (summary)="scopes.push($event)"
    (edit)="edits.push($event)"
    (note)="notes.push($event)"
    (sideNote)="sideNotes.push($event)"
    (flash)="flashes.push($event)"
    (done)="dones = dones + 1"
    (jump)="jumps.push($event)"
  />`,
})
class HostComponent {
  page = signal(1);
  annotations = signal<Annotation[]>([]);
  filter = signal<NotesFilter>('all');
  scopes: SummaryScope[] = [];
  edits: Annotation[] = [];
  notes: Annotation[] = [];
  sideNotes: Annotation[] = [];
  flashes: string[] = [];
  book = { id: 'b1', pageCount: 40, outline: OUTLINE } as Book;
  dones = 0;
  jumps: Place[] = [];
}

describe('NotesTabComponent', () => {
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
    vi.useFakeTimers();
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [{ provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => 5000 } }],
    });
  });
  afterEach(async () => {
    vi.useRealTimers();
    fixture?.destroy();
    await db.delete();
  });

  const rect = (y: number) => ({ x: 0.1, y, w: 0.5, h: 0.02 });
  const hl = (id: string, page: number, quote: string, y = 0.4): Annotation => ({
    id, bookId: 'b1', type: 'highlight', page, color: 'yellow', tags: ['t1'], createdAt: page, updatedAt: 1, deviceId: 'd',
    text: { page, start: { item: 0, offset: 0 }, end: { item: 0, offset: 3 }, rects: [rect(y)], quote },
  });
  const side = (id: string, page: number, body: string): Annotation => ({
    id, bookId: 'b1', type: 'side-note', page, body, tags: [], createdAt: page, updatedAt: 1, deviceId: 'd',
  });
  const sum = (id: string, body: string): Annotation => ({
    id, bookId: 'b1', type: 'summary', scope: { kind: 'book' }, body, tags: [], createdAt: 1, updatedAt: 1, deviceId: 'd',
  });
  const group = (id: string) => Array.from(el.querySelectorAll<HTMLElement>(`[data-group="${id}"] .prev`)).map((n) => n.textContent!.trim());
  const chip = (name: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('.chip')).find((c) => c.textContent!.trim() === name)!;

  function notesTab(anns: Annotation[], page = 2) {
    create((h) => {
      h.page.set(page);
      h.annotations.set(anns);
    });
  }

  it('groups notes into On this page and Rest of the book, in page order', () => {
    notesTab([hl('h9', 9, 'ninth'), hl('h2', 2, 'second'), side('s5', 5, 'five')]);
    expect(group('here')).toEqual(['second']);
    expect(group('rest')).toEqual(['five', 'ninth']);
    expect(Array.from(el.querySelectorAll('.group')).map((g) => g.textContent)).toEqual([COPY.annotations.onThisPage, COPY.annotations.restOfBook]);
    expect(el.querySelector('[data-group=here] .prev')!.getAttribute('dir')).toBe('auto');
    expect(el.querySelector('[data-group=here] .tag')!.textContent).toBe('t1');
    expect(el.querySelector('[data-group=here] .num')!.textContent).toBe('p. 2');
  });

  it('lists the book summary first in the rest, before page 5', () => {
    notesTab([side('s5', 5, 'five'), sum('b', 'whole')], 1);
    expect(group('rest')).toEqual(['whole', 'five']);
  });

  it('the Summaries chip hides highlights; All brings them back', () => {
    notesTab([hl('h2', 2, 'second'), sum('b', 'whole')]);
    chip(COPY.annotations.filters.summaries).click();
    fixture.detectChanges();
    expect([...group('here'), ...group('rest')]).toEqual(['whole']);
    expect(chip(COPY.annotations.filters.summaries).getAttribute('aria-pressed')).toBe('true');
    chip(COPY.annotations.filters.all).click();
    fixture.detectChanges();
    expect([...group('here'), ...group('rest')]).toEqual(['second', 'whole']);
  });

  it('the Notes chip covers notes and side notes', () => {
    notesTab([hl('h2', 2, 'second'), side('s5', 5, 'five')]);
    chip(COPY.annotations.filters.notes).click();
    fixture.detectChanges();
    expect([...group('here'), ...group('rest')]).toEqual(['five']);
  });

  it('shows the empty state', () => {
    notesTab([]);
    expect(el.textContent).toContain(COPY.annotations.noNotes);
  });

  it('tapping a highlight row jumps just above it and asks for a flash', () => {
    notesTab([hl('h9', 9, 'ninth', 0.4), hl('h8', 8, 'eighth', 0.02)]);
    const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('.nrow'));
    rows[1].click();
    expect(host.jumps).toEqual([{ page: 9, offset: 0.4 - 0.05 }]);
    expect(host.flashes).toEqual(['h9']);
    expect(host.dones).toBe(1);
    rows[0].click();
    expect(host.jumps[1].page).toBe(8);
    expect(host.jumps[1].offset).toBe(0);
  });

  it('tapping a side note or summary row opens the editor; the pencil opens the note sheet', () => {
    notesTab([hl('h2', 2, 'second'), side('s5', 5, 'five'), sum('b', 'whole')]);
    const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('.nrow'));
    rows[1].click(); // book summary sorts first in the rest group
    rows[2].click();
    expect(host.edits.map((a) => a.id)).toEqual(['b', 's5']);
    expect(host.jumps).toEqual([]);
    const pencils = Array.from(el.querySelectorAll<HTMLButtonElement>('button.tool'));
    expect(pencils).toHaveLength(1);
    pencils[0].click();
    expect(host.notes.map((a) => a.id)).toEqual(['h2']);
  });

  it('the side-note action creates one on the current page and hands it over', async () => {
    notesTab([], 4);
    vi.useRealTimers();
    const btn = Array.from(el.querySelectorAll<HTMLButtonElement>('.act')).find((b) => b.textContent!.trim() === COPY.annotations.sideNoteOn(4))!;
    btn.click();
    await vi.waitFor(() => expect(host.sideNotes).toHaveLength(1));
    expect(host.sideNotes[0]).toMatchObject({ type: 'side-note', page: 4, bookId: 'b1' });
    expect((await db.annotations.toArray()).filter((a) => a.type === 'side-note')).toHaveLength(1);
  });

  it('the page-range action creates nothing and asks for a pages scope on this page', async () => {
    notesTab([], 6);
    Array.from(el.querySelectorAll<HTMLButtonElement>('.act')).find((b) => b.textContent!.trim() === COPY.annotations.pageRangeSummary)!.click();
    expect(host.scopes).toEqual([{ kind: 'pages', fromPage: 6, toPage: 6 }]);
    vi.useRealTimers();
    expect(await db.annotations.count()).toBe(0);
  });
});
