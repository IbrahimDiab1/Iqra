import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationService } from '../annotations/annotation.service';
import { ReadMarkService } from '../progress/read-mark.service';
import { ReaderActions } from './reader-actions';
import { SelectionService } from './selection.service';
import { UndoStack } from './undo-stack';

describe('ReaderActions.listen', () => {
  let actions: ReaderActions;
  let spoken: { lang: string; onend: (() => void) | null }[];
  const cancel = vi.fn();

  beforeEach(() => {
    spoken = [];
    cancel.mockClear();
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        lang = '';
        voice: unknown;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(public text: string) {}
      },
    );
    vi.stubGlobal('speechSynthesis', { getVoices: () => [], cancel, speak: (u: { lang: string; onend: (() => void) | null }) => spoken.push(u) });
    const pending = signal({ page: 1, quote: 'كتاب', rect: {} as DOMRect, start: { item: 0, offset: 0 }, end: { item: 0, offset: 1 }, source: 'page' as const });
    TestBed.configureTestingModule({
      providers: [
        ReaderActions,
        UndoStack,
        { provide: SelectionService, useValue: { pending } },
        { provide: AnnotationService, useValue: {} },
        { provide: ReadMarkService, useValue: {} },
      ],
    });
    actions = TestBed.inject(ReaderActions);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads the selection in its script language and a second press stops it', () => {
    actions.listen();
    expect(spoken).toHaveLength(1);
    expect(spoken[0].lang).toBe('ar');
    expect(actions.listening()).toBe(true);
    cancel.mockClear();
    actions.listen();
    expect(cancel).toHaveBeenCalled();
    expect(actions.listening()).toBe(false);
    expect(spoken).toHaveLength(1);
  });

  it('clears the listening state when speech ends', () => {
    actions.listen();
    spoken[0].onend!();
    expect(actions.listening()).toBe(false);
  });
});
