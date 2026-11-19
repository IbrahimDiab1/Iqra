import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Book } from '../core/models';
import { COPY } from '../ui/copy';
import { CHROME_COPY } from './chrome-copy';
import { ReaderToolbarComponent, type ToolbarAction } from './reader-toolbar.component';

@Component({
  imports: [ReaderToolbarComponent],
  template: `<iqra-reader-toolbar
    [view]="view()"
    [tool]="tool()"
    [bookmarked]="bookmarked()"
    [progressMode]="mode()"
    [pageMarked]="pageMarked()"
    [canUndo]="canUndo()"
    [noteCount]="notes()"
    [fullscreen]="full()"
    (action)="actions.push($event)"
    (progressModeChange)="modes.push($event)"
  />`,
})
class HostComponent {
  view = signal<'page' | 'reflow'>('page');
  tool = signal<'none' | 'area'>('none');
  bookmarked = signal(false);
  mode = signal<Book['progressMode']>('last-page');
  pageMarked = signal(false);
  canUndo = signal(false);
  notes = signal(0);
  full = signal(false);
  actions: ToolbarAction[] = [];
  modes: Book['progressMode'][] = [];
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
  const update = (fn: () => void) => {
    fn();
    fixture.detectChanges();
  };

  it('is one vertical toolbar with the eleven buttons in order, each labelled and at least 40 px', () => {
    create();
    const bar = el.querySelector('[role=toolbar]')!;
    expect(bar.getAttribute('aria-orientation')).toBe('vertical');
    const ids = Array.from(bar.querySelectorAll('button')).map((b) => b.getAttribute('data-tool'));
    expect(ids).toEqual(['contents', 'search', 'bookmark', 'mark', 'area', 'mode', 'settings', 'progress', 'undo', 'redo', 'fullscreen']);
    for (const b of Array.from(bar.querySelectorAll('button'))) expect(b.getAttribute('aria-label')).toBeTruthy();
    expect(tool('contents').getAttribute('aria-label')).toBe(CHROME_COPY.contentsNotes);
    expect(tool('bookmark').getAttribute('data-shortcut')).toBe('B');
    expect(tool('undo').getAttribute('data-shortcut')).toBe('Ctrl+Z');
  });

  it('every press reports its action', () => {
    create();
    update(() => host.canUndo.set(true));
    for (const id of ['contents', 'search', 'bookmark', 'mark', 'area', 'mode', 'settings', 'undo', 'fullscreen']) tool(id).click();
    expect(host.actions).toEqual(['contents', 'search', 'bookmark', 'mark', 'area', 'mode', 'settings', 'undo', 'fullscreen']);
  });

  it('toggles carry aria-pressed and flip their label', () => {
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
    update(() => host.view.set('reflow'));
    expect(tool('mode').getAttribute('aria-label')).toBe(COPY.reader.pageView);
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

  it('Undo and Redo are disabled until there is something to do', () => {
    create();
    expect(tool('undo').disabled).toBe(true);
    expect(tool('redo').disabled).toBe(true);
    update(() => host.canUndo.set(true));
    expect(tool('undo').disabled).toBe(false);
  });

  it('shows the note count on Contents and hides it at zero', () => {
    create();
    expect(tool('contents').querySelector('.badge')).toBeNull();
    update(() => host.notes.set(3));
    expect(tool('contents').querySelector('.badge')!.textContent!.trim()).toBe('3');
  });

  it('the progress popover offers both modes, reports a change and closes', () => {
    create();
    tool('progress').click();
    fixture.detectChanges();
    expect(tool('progress').getAttribute('aria-expanded')).toBe('true');
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]'));
    expect(items.map((b) => b.textContent!.trim())).toEqual([CHROME_COPY.trackByLast, CHROME_COPY.trackByMarked]);
    expect(items.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    items[0].click();
    fixture.detectChanges();
    expect(host.modes).toEqual([]);
    expect(el.querySelector('[role=menu]')).toBeNull();

    tool('progress').click();
    fixture.detectChanges();
    el.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')[1].click();
    expect(host.modes).toEqual(['marked']);
  });

  it('the popover closes on Escape and on a press elsewhere', () => {
    create();
    tool('progress').click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('[role=menu]')).toBeNull();
    tool('progress').click();
    fixture.detectChanges();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('[role=menu]')).toBeNull();
  });

  it('Up, Down, Home and End move focus between the enabled buttons', () => {
    create();
    document.body.append(el);
    tool('contents').focus();
    const press = (key: string) => tool('contents').closest('[role=toolbar]')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    press('ArrowDown');
    expect(document.activeElement).toBe(tool('search'));
    press('End');
    expect(document.activeElement).toBe(tool('fullscreen'));
    press('ArrowUp');
    // Undo and Redo are disabled, so Up skips to Progress mode.
    expect(document.activeElement).toBe(tool('progress'));
    press('Home');
    expect(document.activeElement).toBe(tool('contents'));
    el.remove();
  });
});
