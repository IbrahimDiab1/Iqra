import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipService } from './tooltip.service';

function pointer(type: string, target: Element, pointerType = 'mouse', init: PointerEventInit = {}): void {
  const e = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  Object.defineProperty(e, 'relatedTarget', { value: init.relatedTarget ?? null });
  target.dispatchEvent(e);
}

describe('TooltipService', () => {
  let stop: () => void;
  let btn: HTMLButtonElement;
  const tip = () => document.getElementById('iqra-tooltip');
  const visible = () => !!tip() && tip()!.style.display !== 'none';

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<button id="a" aria-label="Bookmark this page" data-shortcut="B"><svg></svg></button>' +
      '<button id="t">Visible text</button><a id="l" href="#" aria-label="Back"><svg></svg></a>' +
      '<button id="w" aria-label="With words">Words</button>';
    btn = document.getElementById('a') as HTMLButtonElement;
    stop = TestBed.inject(TooltipService).install();
  });

  afterEach(() => {
    stop();
    tip()?.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('shows the label with its shortcut after 350 ms of hovering, and describes the target', () => {
    pointer('pointerover', btn);
    vi.advanceTimersByTime(349);
    expect(visible()).toBe(false);
    vi.advanceTimersByTime(2);
    expect(visible()).toBe(true);
    expect(tip()!.getAttribute('role')).toBe('tooltip');
    expect(tip()!.textContent).toContain('Bookmark this page');
    expect(tip()!.querySelector('kbd')!.textContent).toBe('B');
    expect(btn.getAttribute('aria-describedby')).toBe('iqra-tooltip');
  });

  it('works for links that are named only by aria-label', () => {
    pointer('pointerover', document.getElementById('l')!);
    vi.advanceTimersByTime(400);
    expect(tip()!.textContent).toContain('Back');
    expect(tip()!.querySelector('kbd')).toBeNull();
  });

  it('never shows for touch', () => {
    pointer('pointerover', btn, 'touch');
    vi.advanceTimersByTime(1000);
    expect(tip()).toBeNull();
  });

  it('skips buttons that already show text', () => {
    pointer('pointerover', document.getElementById('t')!);
    pointer('pointerover', document.getElementById('w')!);
    vi.advanceTimersByTime(1000);
    expect(tip()).toBeNull();
  });

  it('hides on Escape, click, scroll and when the pointer leaves, and a quick leave never shows it', () => {
    const open = () => {
      pointer('pointerover', btn);
      vi.advanceTimersByTime(400);
      expect(visible()).toBe(true);
    };
    open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(visible()).toBe(false);
    expect(btn.hasAttribute('aria-describedby')).toBe(false);
    open();
    btn.click();
    expect(visible()).toBe(false);
    open();
    document.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    document.body.dispatchEvent(new Event('scroll'));
    expect(visible()).toBe(false);
    open();
    pointer('pointerout', btn);
    expect(visible()).toBe(false);
    pointer('pointerover', btn);
    vi.advanceTimersByTime(100);
    pointer('pointerout', btn);
    vi.advanceTimersByTime(1000);
    expect(visible()).toBe(false);
  });

  it('moving between the icon and its button does not restart the delay or flicker', () => {
    const svg = btn.querySelector('svg')!;
    pointer('pointerover', btn);
    vi.advanceTimersByTime(300);
    pointer('pointerover', svg);
    vi.advanceTimersByTime(60);
    expect(visible()).toBe(true);
    pointer('pointerout', btn, 'mouse', { relatedTarget: svg });
    expect(visible()).toBe(true);
  });

  it('shows for keyboard focus only', () => {
    vi.spyOn(btn, 'matches').mockImplementation((q) => q === ':focus-visible');
    btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(400);
    expect(visible()).toBe(true);
    btn.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(visible()).toBe(false);
    vi.spyOn(btn, 'matches').mockReturnValue(false);
    btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(400);
    expect(visible()).toBe(false);
  });

  it('keeps itself inside the viewport', () => {
    btn.getBoundingClientRect = () => ({ left: window.innerWidth - 20, right: window.innerWidth, top: 100, bottom: 140, width: 20, height: 40, x: 0, y: 0, toJSON: () => ({}) });
    pointer('pointerover', btn);
    vi.advanceTimersByTime(400);
    const left = parseFloat(tip()!.style.left);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left).toBeLessThanOrEqual(window.innerWidth);
  });

  it('install is idempotent and stopping removes the listeners', () => {
    const svc = TestBed.inject(TooltipService);
    expect(svc.install()).toBe(stop);
    stop();
    pointer('pointerover', btn);
    vi.advanceTimersByTime(1000);
    expect(visible()).toBe(false);
  });

  it('destroying the service (a test injector, a torn-down app) removes its listeners too', () => {
    TestBed.resetTestingModule();
    pointer('pointerover', btn);
    vi.advanceTimersByTime(1000);
    expect(visible()).toBe(false);
  });
});
