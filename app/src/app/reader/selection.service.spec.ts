import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextItem } from './text';
import { SelectionService } from './selection.service';

function item(str: string): TextItem {
  return { str, width: 10, height: 10, transform: [1, 0, 0, 1, 0, 0] } as TextItem;
}

const ITEMS: TextItem[] = [item('Hello world'), item('second line')];

function buildLayer(page: number): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'text-layer';
  layer.dataset['page'] = String(page);
  ITEMS.forEach((it, i) => {
    const s = document.createElement('span');
    s.dataset['item'] = String(i);
    s.textContent = it.str;
    layer.appendChild(s);
  });
  document.body.appendChild(layer);
  return layer;
}

function select(a: Node, ao: number, b: Node, bo: number): void {
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.setBaseAndExtent(a, ao, b, bo);
  document.dispatchEvent(new Event('selectionchange'));
}

describe('SelectionService', () => {
  let svc: SelectionService;
  let layers: HTMLElement[];

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [SelectionService] });
    svc = TestBed.inject(SelectionService);
    svc.attach({ items: async () => ITEMS });
    layers = [buildLayer(2), buildLayer(3)];
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    layers.forEach((l) => l.remove());
    vi.useRealTimers();
  });

  const text = (layer: HTMLElement, i: number) => layer.children[i].firstChild as Text;

  async function flush() {
    await vi.advanceTimersByTimeAsync(200);
  }

  it('publishes an ordered selection within one page after the debounce', async () => {
    select(text(layers[0], 0), 2, text(layers[0], 1), 3);
    expect(svc.pending()).toBeNull();
    await flush();
    expect(svc.pending()).toMatchObject({
      page: 2,
      start: { item: 0, offset: 2 },
      end: { item: 1, offset: 3 },
      quote: 'llo world sec',
      source: 'page',
    });
    expect(svc.active()).toBe(true);
  });

  it('orders a reversed selection', async () => {
    select(text(layers[0], 1), 3, text(layers[0], 0), 2);
    await flush();
    expect(svc.pending()).toMatchObject({ start: { item: 0, offset: 2 }, end: { item: 1, offset: 3 } });
  });

  it('ignores a selection across two pages but still counts as active', async () => {
    select(text(layers[0], 0), 1, text(layers[1], 1), 2);
    await flush();
    expect(svc.pending()).toBeNull();
    expect(svc.active()).toBe(true);
  });

  it('ignores a selection outside any text layer', async () => {
    const p = document.createElement('p');
    p.textContent = 'plain';
    document.body.appendChild(p);
    select(p.firstChild!, 0, p.firstChild!, 3);
    await flush();
    p.remove();
    expect(svc.pending()).toBeNull();
    expect(svc.active()).toBe(false);
  });

  it('is empty when the selection collapses', async () => {
    select(text(layers[0], 0), 2, text(layers[0], 0), 5);
    await flush();
    expect(svc.pending()).not.toBeNull();
    select(text(layers[0], 0), 2, text(layers[0], 0), 2);
    await flush();
    expect(svc.pending()).toBeNull();
    expect(svc.active()).toBe(false);
  });

  it('clear() empties the pending value and the browser selection', async () => {
    select(text(layers[0], 0), 2, text(layers[0], 0), 5);
    await flush();
    svc.clear();
    expect(svc.pending()).toBeNull();
    expect(svc.active()).toBe(false);
    expect(window.getSelection()!.isCollapsed).toBe(true);
  });
});
