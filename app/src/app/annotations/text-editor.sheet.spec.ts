import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '../core/models';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
import { AnnotationService } from './annotation.service';
import { TextEditorSheet } from './text-editor.sheet';

const SUMMARY: Annotation = {
  id: 's1', bookId: 'b1', deviceId: 'd', updatedAt: 1, createdAt: 1, type: 'summary', tags: [], body: 'old',
  scope: { kind: 'pages', fromPage: 10, toPage: 20 },
};

@Component({
  imports: [TextEditorSheet],
  template: `<iqra-text-editor-sheet [annotation]="annotation()" [draft]="draft()" [isNew]="isNew()" [tagSuggestions]="[]" [pageCount]="50" (closed)="closed = closed + 1" />`,
})
class HostComponent {
  readonly annotation = signal<Annotation | null>(null);
  readonly draft = signal(false);
  readonly isNew = signal(false);
  closed = 0;
}

describe('TextEditorSheet', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;
  let svc: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn>; restoreIfOurs: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    svc = {
      create: vi.fn(async (r: Partial<Annotation>) => ({ ...r, id: 'made', updatedAt: 1, deviceId: 'd' })),
      update: vi.fn(async () => undefined),
      remove: vi.fn(async (id: string) => ({ ...SUMMARY, id })),
      restore: vi.fn(async () => undefined),
      restoreIfOurs: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({ providers: [{ provide: AnnotationService, useValue: svc }] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  function open(a: Annotation) {
    host.annotation.set(a);
    fixture.detectChanges();
  }
  const num = (label: string) => el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  function setNum(label: string, v: string) {
    num(label).value = v;
    num(label).dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('titles a pages summary with its range and shows both page inputs', () => {
    open(SUMMARY);
    expect(el.querySelector('h3')!.textContent).toBe(`${COPY.annotations.summary} · ${COPY.annotations.pageRange(10, 20)}`);
    expect(num(COPY.annotations.fromPage).value).toBe('10');
    expect(num(COPY.annotations.toPage).value).toBe('20');
  });

  it('titles book and outline scopes and a side note', () => {
    open({ ...SUMMARY, scope: { kind: 'book' } });
    expect(el.querySelector('h3')!.textContent).toContain(COPY.annotations.scopeBook);
    expect(el.querySelector('input[type=number]')).toBeNull();
    open({ ...SUMMARY, id: 's2', scope: { kind: 'outline', nodeKey: '0', title: 'Intro', fromPage: 1, toPage: 9 } });
    expect(el.querySelector('h3')!.textContent).toContain('Intro');
    open({ ...SUMMARY, id: 'n1', type: 'side-note', page: 4, scope: undefined });
    expect(el.querySelector('h3')!.textContent).toBe(`${COPY.annotations.sideNote} · ${COPY.annotations.pageShort(4)}`);
  });

  it('a toPage below fromPage is corrected to fromPage', () => {
    open(SUMMARY);
    setNum(COPY.annotations.toPage, '3');
    expect(svc.update).toHaveBeenCalledWith('s1', { scope: { kind: 'pages', fromPage: 10, toPage: 10 } });
    expect(num(COPY.annotations.toPage).value).toBe('10');
  });

  it('clamps pages to 1..pageCount and keeps toPage >= fromPage', () => {
    open(SUMMARY);
    setNum(COPY.annotations.toPage, '999');
    expect(svc.update).toHaveBeenLastCalledWith('s1', { scope: { kind: 'pages', fromPage: 10, toPage: 50 } });
    setNum(COPY.annotations.fromPage, '0');
    expect(svc.update).toHaveBeenLastCalledWith('s1', { scope: { kind: 'pages', fromPage: 1, toPage: 50 } });
  });

  it('raising fromPage past toPage drags toPage up', () => {
    open(SUMMARY);
    setNum(COPY.annotations.fromPage, '30');
    expect(svc.update).toHaveBeenLastCalledWith('s1', { scope: { kind: 'pages', fromPage: 30, toPage: 30 } });
  });

  it('closing saves the typed body', async () => {
    open(SUMMARY);
    const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'new text';
    ta.dispatchEvent(new Event('input'));
    el.querySelector<HTMLButtonElement>('button.close')!.click();
    await vi.waitFor(() => expect(svc.update).toHaveBeenCalledWith('s1', { body: 'new text' }));
    expect(host.closed).toBe(1);
  });

  it('Delete removes with an Undo toast', async () => {
    open(SUMMARY);
    el.querySelector<HTMLButtonElement>('button.del')!.click();
    await vi.waitFor(() => expect(svc.remove).toHaveBeenCalledWith('s1'));
    const toast = TestBed.inject(ToastService);
    await vi.waitFor(() => expect(toast.current()?.message).toBe(COPY.annotations.deleted));
    toast.undo();
    expect(svc.restoreIfOurs).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });

  describe('a draft that is not stored yet', () => {
    const DRAFT: Annotation = { ...SUMMARY, id: 'draft', body: undefined, scope: { kind: 'outline', nodeKey: '2', title: 'Two', fromPage: 5, toPage: 9 } };
    function openDraft() {
      host.draft.set(true);
      open(DRAFT);
    }
    function typeBody(v: string) {
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
      ta.value = v;
      ta.dispatchEvent(new Event('input'));
    }

    it('closing it untouched creates nothing', async () => {
      openDraft();
      el.querySelector<HTMLButtonElement>('button.close')!.click();
      await new Promise((r) => setTimeout(r, 20));
      expect(svc.create).not.toHaveBeenCalled();
      expect(svc.update).not.toHaveBeenCalled();
      expect(host.closed).toBe(1);
    });

    it('whitespace-only text creates nothing', async () => {
      openDraft();
      typeBody('   ');
      el.querySelector<HTMLButtonElement>('button.close')!.click();
      await new Promise((r) => setTimeout(r, 20));
      expect(svc.create).not.toHaveBeenCalled();
    });

    it('the first non-empty save creates the record with its scope; later saves update it', async () => {
      openDraft();
      typeBody('first');
      el.querySelector<HTMLTextAreaElement>('textarea')!.dispatchEvent(new Event('blur'));
      await vi.waitFor(() => expect(svc.create).toHaveBeenCalledTimes(1));
      expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({ bookId: 'b1', type: 'summary', body: 'first', scope: DRAFT.scope }));
      typeBody('second');
      el.querySelector<HTMLTextAreaElement>('textarea')!.dispatchEvent(new Event('blur'));
      await vi.waitFor(() => expect(svc.update).toHaveBeenCalledWith('made', { body: 'second' }));
      expect(svc.create).toHaveBeenCalledTimes(1);
    });

    it('Delete on a draft that was never stored just closes', async () => {
      openDraft();
      el.querySelector<HTMLButtonElement>('button.del')!.click();
      await new Promise((r) => setTimeout(r, 20));
      expect(svc.remove).not.toHaveBeenCalled();
      expect(host.closed).toBe(1);
    });
  });

  it('destroying without close saves typed text of an existing summary', () => {
    open(SUMMARY);
    const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'typed then Back';
    ta.dispatchEvent(new Event('input'));
    fixture.destroy();
    expect(svc.update).toHaveBeenCalledWith('s1', { body: 'typed then Back' });
  });

  it('destroying without close creates a draft summary that has text', async () => {
    host.draft.set(true);
    open({ ...SUMMARY, id: 'draft', body: undefined, scope: { kind: 'book' } });
    const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
    ta.value = 'whole book in a line';
    ta.dispatchEvent(new Event('input'));
    fixture.destroy();
    await vi.waitFor(() => expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'summary', body: 'whole book in a line' })));
  });

  it('destroying an empty draft stores nothing', async () => {
    host.draft.set(true);
    open({ ...SUMMARY, id: 'draft', body: undefined, scope: { kind: 'book' } });
    fixture.destroy();
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('destroying a new, still empty side note removes it', () => {
    host.isNew.set(true);
    open({ ...SUMMARY, id: 'n1', type: 'side-note', page: 4, scope: undefined, body: undefined });
    fixture.destroy();
    expect(svc.remove).toHaveBeenCalledWith('n1');
  });

  it('hiding the page saves pending text', () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      open(SUMMARY);
      const ta = el.querySelector<HTMLTextAreaElement>('textarea')!;
      ta.value = 'switching apps';
      ta.dispatchEvent(new Event('input'));
      document.dispatchEvent(new Event('visibilitychange'));
      expect(svc.update).toHaveBeenCalledWith('s1', { body: 'switching apps' });
    } finally {
      hidden.mockRestore();
    }
  });
});
