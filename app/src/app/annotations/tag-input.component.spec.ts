import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Annotation } from '../core/models';
import { COPY } from '../ui/copy';
import { TagInputComponent, tagSuggestionsFrom } from './tag-input.component';

@Component({
  imports: [TagInputComponent],
  template: `<iqra-tag-input [(tags)]="tags" [suggestions]="suggestions()" />`,
})
class HostComponent {
  readonly tags = signal<string[]>([]);
  readonly suggestions = signal<string[]>([]);
}

describe('TagInputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  const input = () => el.querySelector<HTMLInputElement>('input')!;
  function type(value: string, key?: string) {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    if (key) input().dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
    fixture.detectChanges();
  }

  it('Enter adds a normalized tag', () => {
    type(' Big Question ', 'Enter');
    expect(host.tags()).toEqual(['big-question']);
    expect(input().value).toBe('');
  });

  it('a comma adds the tag', () => {
    type('fiqh', ',');
    expect(host.tags()).toEqual(['fiqh']);
  });

  it('the Arabic comma adds the tag', () => {
    type('علم', '،');
    expect(host.tags()).toEqual(['علم']);
  });

  it('Enter while an IME is composing does not commit', () => {
    input().value = 'ni';
    input().dispatchEvent(new Event('input'));
    const e = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, cancelable: true });
    input().dispatchEvent(e);
    fixture.detectChanges();
    expect(host.tags()).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });

  it('blur adds the pending text', () => {
    type('hadith');
    input().dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(host.tags()).toEqual(['hadith']);
  });

  it('ignores duplicates and empty values', () => {
    host.tags.set(['fiqh']);
    fixture.detectChanges();
    type('  FIQH ', 'Enter');
    type('   ', 'Enter');
    type('###', 'Enter');
    expect(host.tags()).toEqual(['fiqh']);
  });

  it('the remove button removes a tag and is at least 40 px', () => {
    host.tags.set(['a', 'b']);
    fixture.detectChanges();
    const rm = el.querySelector<HTMLButtonElement>(`button[aria-label="${COPY.annotations.removeTag('a')}"]`)!;
    expect(rm).not.toBeNull();
    rm.click();
    fixture.detectChanges();
    expect(host.tags()).toEqual(['b']);
  });

  it('a suggestion chip adds the tag; at most 6, prefix match, existing excluded', () => {
    host.tags.set(['tafsir']);
    host.suggestions.set(['tafsir', 'taw', 'ta1', 'ta2', 'ta3', 'ta4', 'ta5', 'ta6', 'other']);
    fixture.detectChanges();
    type('ta');
    const chips = Array.from(el.querySelectorAll<HTMLButtonElement>('button.sug'));
    expect(chips.map((c) => c.textContent!.trim())).toEqual(['taw', 'ta1', 'ta2', 'ta3', 'ta4', 'ta5']);
    chips[0].click();
    fixture.detectChanges();
    expect(host.tags()).toEqual(['tafsir', 'taw']);
  });
});

describe('tagSuggestionsFrom', () => {
  const rec = (tags: string[], deleted = false) => ({ tags, deleted }) as unknown as Annotation;
  it('counts live annotations only, by frequency then name', () => {
    expect(tagSuggestionsFrom([rec(['b', 'a']), rec(['b']), rec(['c'], true), rec(['a'])])).toEqual(['a', 'b']);
    expect(tagSuggestionsFrom([rec(['z']), rec(['y', 'z']), rec(['x'])])).toEqual(['z', 'x', 'y']);
    expect(tagSuggestionsFrom(undefined)).toEqual([]);
  });
});
