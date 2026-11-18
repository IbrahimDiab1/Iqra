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
  template: `<iqra-text-editor-sheet [annotation]="annotation()" [tagSuggestions]="[]" [pageCount]="50" (closed)="closed = closed + 1" />`,
})
class HostComponent {
  readonly annotation = signal<Annotation | null>(null);
  closed = 0;
}

describe('TextEditorSheet', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;
  let svc: { update: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    svc = {
      update: vi.fn(async () => undefined),
      remove: vi.fn(async (id: string) => ({ ...SUMMARY, id })),
      restore: vi.fn(async () => undefined),
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
    expect(svc.restore).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });
});
