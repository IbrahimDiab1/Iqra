import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../core/models';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
import { AnnotationService } from './annotation.service';
import { NoteSheetComponent } from './note-sheet.component';

const REC: Annotation = {
  id: 'a1', bookId: 'b1', deviceId: 'd', updatedAt: 1, createdAt: 1, type: 'highlight', page: 3, color: 'yellow',
  text: { page: 3, start: { item: 0, offset: 0 }, end: { item: 0, offset: 5 }, rects: [], quote: 'Quoted text' },
  tags: [], body: '',
};

@Component({
  imports: [NoteSheetComponent],
  template: `<iqra-note-sheet [annotation]="annotation()" [isNew]="isNew()" [tagSuggestions]="[]" (closed)="closed = closed + 1" />`,
})
class HostComponent {
  readonly annotation = signal<Annotation | null>(null);
  readonly isNew = signal(true);
  closed = 0;
}

describe('NoteSheetComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;
  let svc: { update: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn>; restoreIfOurs: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    svc = {
      update: vi.fn(async () => undefined),
      remove: vi.fn(async (id: string) => ({ ...REC, id })),
      restore: vi.fn(async () => undefined),
      restoreIfOurs: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({ providers: [{ provide: AnnotationService, useValue: svc }] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => vi.useRealTimers());

  function open(a: Annotation) {
    host.annotation.set(a);
    fixture.detectChanges();
  }
  const textarea = () => el.querySelector<HTMLTextAreaElement>('textarea')!;
  const closeBtn = () => el.querySelector<HTMLButtonElement>('button.close')!;
  function typeBody(v: string) {
    textarea().value = v;
    textarea().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('shows the quote with dir=auto', () => {
    open(REC);
    const q = el.querySelector('.quote')!;
    expect(q.textContent).toContain('Quoted text');
    expect(q.getAttribute('dir')).toBe('auto');
  });

  it('typing then closing saves the body', async () => {
    open(REC);
    typeBody('my thought');
    closeBtn().click();
    await vi.waitFor(() => expect(svc.update).toHaveBeenCalledWith('a1', { body: 'my thought' }));
    expect(host.closed).toBe(1);
  });

  it('typing saves after a 400 ms debounce, blur saves at once', async () => {
    vi.useFakeTimers();
    open(REC);
    typeBody('abc');
    vi.advanceTimersByTime(399);
    expect(svc.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(svc.update).toHaveBeenCalledWith('a1', { body: 'abc' });
    svc.update.mockClear();
    typeBody('abcd');
    textarea().dispatchEvent(new Event('blur'));
    expect(svc.update).toHaveBeenCalledWith('a1', { body: 'abcd' });
    vi.advanceTimersByTime(1000);
    expect(svc.update).toHaveBeenCalledTimes(1);
  });

  it('changing the color updates the annotation', () => {
    open(REC);
    el.querySelector<HTMLButtonElement>(`button[aria-label="${COPY.annotations.colors.blue}"]`)!.click();
    expect(svc.update).toHaveBeenCalledWith('a1', { color: 'blue' });
  });

  it('adding a tag updates the annotation', () => {
    open(REC);
    const input = el.querySelector<HTMLInputElement>('iqra-tag-input input')!;
    input.value = 'Fiqh';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    fixture.detectChanges();
    expect(svc.update).toHaveBeenCalledWith('a1', { tags: ['fiqh'] });
  });

  it('Delete removes the record and the toast Undo restores it', async () => {
    open(REC);
    el.querySelector<HTMLButtonElement>('button.del')!.click();
    await vi.waitFor(() => expect(svc.remove).toHaveBeenCalledWith('a1'));
    const toast = TestBed.inject(ToastService);
    await vi.waitFor(() => expect(toast.current()?.message).toBe(COPY.annotations.deleted));
    toast.undo();
    expect(svc.restoreIfOurs).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
    expect(host.closed).toBe(1);
  });

  it('a new empty note closed untouched is removed', async () => {
    open({ ...REC, id: 'n1', type: 'note', color: undefined });
    closeBtn().click();
    await vi.waitFor(() => expect(svc.remove).toHaveBeenCalledWith('n1'));
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('an old empty note opened from a tap is not removed on close', async () => {
    host.isNew.set(false);
    open({ ...REC, id: 'old', type: 'note', color: undefined });
    closeBtn().click();
    await vi.waitFor(() => expect(host.closed).toBe(1));
    expect(svc.remove).not.toHaveBeenCalled();
  });

  it('a note with text is kept on close', async () => {
    open({ ...REC, id: 'n1', type: 'note', color: undefined });
    typeBody('kept');
    closeBtn().click();
    await vi.waitFor(() => expect(svc.update).toHaveBeenCalledWith('n1', { body: 'kept' }));
    expect(svc.remove).not.toHaveBeenCalled();
  });

  it('focuses the textarea on a new note', async () => {
    open({ ...REC, id: 'n1', type: 'note', color: undefined });
    await vi.waitFor(() => expect(document.activeElement).toBe(textarea()));
  });

  it('has no color dots for a note, and has them for a highlight and an area', () => {
    open({ ...REC, type: 'note', color: undefined, body: 'x' });
    expect(el.querySelector('.colors')).toBeNull();
    open({ ...REC, id: 'a2', type: 'highlight' });
    expect(el.querySelector('.colors')).not.toBeNull();
    open({ ...REC, id: 'a3', type: 'area', text: undefined, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    expect(el.querySelector('.colors')).not.toBeNull();
    expect(el.querySelector('.quote')).toBeNull();
  });

  it('destroying the sheet while typing saves the body without a close', async () => {
    open(REC);
    typeBody('typed then Back');
    fixture.destroy();
    expect(svc.update).toHaveBeenCalledWith('a1', { body: 'typed then Back' });
  });

  it('destroying a new, still empty note removes it', async () => {
    open({ ...REC, id: 'n9', type: 'note', text: undefined });
    fixture.destroy();
    expect(svc.remove).toHaveBeenCalledWith('n9');
  });

  it('destroying a new note with text keeps it', async () => {
    open({ ...REC, id: 'n9', type: 'note', text: undefined });
    typeBody('keep me');
    fixture.destroy();
    expect(svc.update).toHaveBeenCalledWith('n9', { body: 'keep me' });
    expect(svc.remove).not.toHaveBeenCalled();
  });

  it('hiding the page saves pending text and closes a new empty note', async () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      open(REC);
      typeBody('half done');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(svc.update).toHaveBeenCalledWith('a1', { body: 'half done' });
      expect(host.closed).toBe(0);
      open({ ...REC, id: 'n8', type: 'note', text: undefined });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(svc.remove).toHaveBeenCalledWith('n8');
      expect(host.closed).toBe(1);
    } finally {
      hidden.mockRestore();
    }
  });
});
