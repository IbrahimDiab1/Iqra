import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '../core/models';
import { COPY } from '../ui/copy';
import { CHROME_COPY } from './chrome-copy';
import { ReaderToolbarComponent, TOOLBAR_HIDE_MS, TOOLBAR_NEAR_PX, type ToolbarAction } from './reader-toolbar.component';

@Component({
  imports: [ReaderToolbarComponent],
  template: `<iqra-reader-toolbar
    [view]="view()"
    [tool]="tool()"
    [bookmarked]="bookmarked()"
    [progressMode]="mode()"
    [pageMarked]="pageMarked()"
    [canUndo]="canUndo()"
    [canZoomIn]="canZoomIn()"
    [hold]="hold()"
    [fullscreen]="full()"
    (action)="actions.push($event)"
  />`,
})
class HostComponent {
  toolbar = viewChild.required(ReaderToolbarComponent);
  view = signal<'page' | 'reflow'>('page');
  tool = signal<'none' | 'area'>('none');
  bookmarked = signal(false);
  mode = signal<Book['progressMode']>('last-page');
  pageMarked = signal(false);
  canUndo = signal(false);
  canZoomIn = signal(true);
  hold = signal(false);
  full = signal(false);
  actions: ToolbarAction[] = [];
}

describe('ReaderToolbarComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  function create() {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }
  const tool = (id: string) => el.querySelector<HTMLButtonElement>(`button[data-tool="${id}"]`)!;
  const bar = () => el.querySelector<HTMLElement>('[role=toolbar]')!;
  const shown = () => !bar().classList.contains('away');
  const update = (fn: () => void) => {
    fn();
    fixture.detectChanges();
  };
  const move = (y: number, pointerType = 'mouse') => {
    const e = new Event('pointermove', { bubbles: true }) as Event & { clientY: number; pointerType: string };
    e.clientY = y;
    e.pointerType = pointerType;
    document.dispatchEvent(e);
    fixture.detectChanges();
  };
  const tick = (ms: number) => {
    vi.advanceTimersByTime(ms);
    fixture.detectChanges();
  };
  const bottom = () => window.innerHeight - 10;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is one horizontal toolbar with zoom in it, every button labelled', () => {
    create();
    expect(bar().getAttribute('aria-orientation')).toBe('horizontal');
    const ids = Array.from(bar().querySelectorAll('button')).map((b) => b.getAttribute('data-tool'));
    expect(ids).toEqual(['contents', 'search', 'bookmark', 'mark', 'area', 'mode', 'settings', 'zoomOut', 'zoomIn', 'undo', 'redo', 'fullscreen']);
    for (const b of Array.from(bar().querySelectorAll('button'))) expect(b.getAttribute('aria-label')).toBeTruthy();
    expect(tool('contents').getAttribute('aria-label')).toBe(CHROME_COPY.contentsNotes);
    expect(tool('zoomIn').getAttribute('aria-label')).toBe(CHROME_COPY.zoomIn);
    expect(tool('bookmark').getAttribute('data-shortcut')).toBe('B');
    expect(tool('undo').getAttribute('data-shortcut')).toBe('Ctrl+Z');
  });

  it('has no progress-mode button and no note-count badge', () => {
    create();
    expect(tool('progress')).toBeNull();
    expect(el.querySelector('.badge')).toBeNull();
  });

  it('every press reports its action', () => {
    create();
    update(() => host.canUndo.set(true));
    for (const id of ['contents', 'search', 'bookmark', 'mark', 'area', 'mode', 'settings', 'zoomOut', 'zoomIn', 'undo', 'fullscreen']) tool(id).click();
    expect(host.actions).toEqual(['contents', 'search', 'bookmark', 'mark', 'area', 'mode', 'settings', 'zoomOut', 'zoomIn', 'undo', 'fullscreen']);
  });

  it('toggles carry aria-pressed and flip their label; reading settings and reading mode have their own icons', () => {
    create();
    expect(tool('bookmark').getAttribute('aria-pressed')).toBe('false');
    expect(tool('bookmark').getAttribute('aria-label')).toBe(COPY.annotations.addBookmark);
    update(() => host.bookmarked.set(true));
    expect(tool('bookmark').getAttribute('aria-pressed')).toBe('true');
    expect(tool('bookmark').getAttribute('aria-label')).toBe(COPY.annotations.removeBookmark);
    update(() => host.tool.set('area'));
    expect(tool('area').getAttribute('aria-pressed')).toBe('true');
    update(() => host.full.set(true));
    expect(tool('fullscreen').getAttribute('aria-label')).toBe(CHROME_COPY.exitFullScreen);
    expect(tool('mode').getAttribute('aria-label')).toBe(COPY.reader.readingMode);
    const readingIcon = tool('mode').innerHTML;
    const settingsIcon = tool('settings').innerHTML;
    update(() => host.view.set('reflow'));
    expect(tool('mode').getAttribute('aria-label')).toBe(COPY.reader.pageView);
    expect(tool('mode').innerHTML).not.toBe(readingIcon);
    expect(tool('settings').innerHTML).toBe(settingsIcon);
    expect(tool('area').disabled).toBe(true);
  });

  it('Mark page read is soft-disabled with the hint in last-page mode and live in marked mode', () => {
    create();
    expect(tool('mark').getAttribute('aria-disabled')).toBe('true');
    expect(tool('mark').getAttribute('aria-label')).toBe(CHROME_COPY.markDisabled);
    expect(tool('mark').hasAttribute('aria-pressed')).toBe(false);
    update(() => host.mode.set('marked'));
    expect(tool('mark').hasAttribute('aria-disabled')).toBe(false);
    expect(tool('mark').getAttribute('aria-pressed')).toBe('false');
    update(() => host.pageMarked.set(true));
    expect(tool('mark').getAttribute('aria-pressed')).toBe('true');
    expect(tool('mark').getAttribute('aria-label')).toBe(CHROME_COPY.unmarkPageRead);
  });

  it('Undo, Redo and a zoom at its limit are disabled', () => {
    create();
    expect(tool('undo').disabled).toBe(true);
    expect(tool('redo').disabled).toBe(true);
    update(() => host.canUndo.set(true));
    expect(tool('undo').disabled).toBe(false);
    update(() => host.canZoomIn.set(false));
    expect(tool('zoomIn').disabled).toBe(true);
    expect(tool('zoomOut').disabled).toBe(false);
  });

  it('arrow keys pressed on a focused button are left to the page (they turn pages)', () => {
    create();
    document.body.append(el);
    const reached = vi.fn();
    document.addEventListener('keydown', reached);
    tool('contents').focus();
    const e = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    bar().dispatchEvent(e);
    expect(reached).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(tool('contents'));
    document.removeEventListener('keydown', reached);
    el.remove();
  });

  describe('auto-hide', () => {
    it('starts shown and hides after 3 s', () => {
      vi.useFakeTimers();
      create();
      expect(shown()).toBe(true);
      tick(TOOLBAR_HIDE_MS - 1);
      expect(shown()).toBe(true);
      tick(1);
      expect(shown()).toBe(false);
    });

    it('a mouse near the bottom edge shows it and keeps it, and it hides 3 s after the mouse leaves', () => {
      vi.useFakeTimers();
      create();
      tick(TOOLBAR_HIDE_MS);
      expect(shown()).toBe(false);
      move(window.innerHeight - TOOLBAR_NEAR_PX - 20);
      expect(shown()).toBe(false);
      move(bottom());
      expect(shown()).toBe(true);
      tick(TOOLBAR_HIDE_MS * 3);
      expect(shown()).toBe(true);
      move(100);
      tick(TOOLBAR_HIDE_MS - 1);
      expect(shown()).toBe(true);
      tick(1);
      expect(shown()).toBe(false);
    });

    it('leaving the window counts as the mouse leaving', () => {
      vi.useFakeTimers();
      create();
      move(bottom());
      document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }));
      tick(TOOLBAR_HIDE_MS);
      expect(shown()).toBe(false);
    });

    it('a touch moving near the bottom edge does not count as a mouse', () => {
      vi.useFakeTimers();
      create();
      tick(TOOLBAR_HIDE_MS);
      move(bottom(), 'touch');
      expect(shown()).toBe(false);
    });

    it('reveal() (a tap on the page) shows it for 3 s; a press inside restarts the 3 s', () => {
      vi.useFakeTimers();
      create();
      tick(TOOLBAR_HIDE_MS);
      host.toolbar().reveal();
      fixture.detectChanges();
      expect(shown()).toBe(true);
      tick(2000);
      tool('search').dispatchEvent(new Event('pointerdown', { bubbles: true }));
      tick(2000);
      expect(shown()).toBe(true);
      tick(1000);
      expect(shown()).toBe(false);
    });

    it('stays while keyboard focus is inside it, then hides 3 s after focus leaves', () => {
      vi.useFakeTimers();
      create();
      document.body.append(el);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
      tool('search').focus();
      tick(TOOLBAR_HIDE_MS * 2);
      expect(shown()).toBe(true);
      tool('search').blur();
      fixture.detectChanges();
      tick(TOOLBAR_HIDE_MS);
      expect(shown()).toBe(false);
      el.remove();
    });

    it('focusing a button while hidden shows it', () => {
      vi.useFakeTimers();
      create();
      document.body.append(el);
      tick(TOOLBAR_HIDE_MS);
      expect(shown()).toBe(false);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
      tool('contents').focus();
      fixture.detectChanges();
      expect(shown()).toBe(true);
      el.remove();
    });

    it('the focus a mouse press leaves on a button does not keep it up', () => {
      vi.useFakeTimers();
      create();
      document.body.append(el);
      document.dispatchEvent(new Event('pointerdown'));
      tool('search').focus();
      tick(TOOLBAR_HIDE_MS);
      expect(shown()).toBe(false);
      el.remove();
    });

    it('stays while the page holds it (an open menu, the area tool) and hides 3 s after the hold ends', () => {
      vi.useFakeTimers();
      create();
      update(() => host.hold.set(true));
      tick(TOOLBAR_HIDE_MS * 2);
      expect(shown()).toBe(true);
      update(() => host.hold.set(false));
      tick(TOOLBAR_HIDE_MS);
      expect(shown()).toBe(false);
    });
  });
});
