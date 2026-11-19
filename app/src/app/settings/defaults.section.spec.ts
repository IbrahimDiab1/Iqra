import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { DefaultsSection } from './defaults.section';

describe('DefaultsSection', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<DefaultsSection>;
  let el: HTMLElement;

  const button = (group: string, label: string) =>
    Array.from(el.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] button`)).find((b) => b.textContent!.trim() === label)!;

  beforeEach(() => {
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [{ provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => 5000 } }],
    });
    fixture = TestBed.createComponent(DefaultsSection);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('shows the current defaults as pressed', () => {
    expect(button('weekStartsOn', 'Saturday').getAttribute('aria-pressed')).toBe('true');
    expect(button('defaultView', 'Page').getAttribute('aria-pressed')).toBe('true');
    expect(button('defaultProgressMode', 'Last page').getAttribute('aria-pressed')).toBe('true');
  });

  it('writes weekStartsOn: 1 when Monday is chosen', async () => {
    button('weekStartsOn', 'Monday').click();
    await vi.waitFor(async () => expect((await db.settings.get('settings'))?.weekStartsOn).toBe(1));
    fixture.detectChanges();
    expect(button('weekStartsOn', 'Monday').getAttribute('aria-pressed')).toBe('true');
  });

  it('writes view, color, progress and page mode', async () => {
    // One tap at a time, as a person would: SettingsService.update is a read-modify-write.
    for (const [group, label] of [['defaultView', 'Reflow'], ['readerTheme', 'Sepia'], ['defaultProgressMode', 'Marked pages'], ['defaultPageMode', 'Scroll']]) {
      button(group, label).click();
      await vi.waitFor(async () => expect(await db.settings.get('settings')).toBeDefined());
      await new Promise((r) => setTimeout(r, 20));
    }
    const s = (await db.settings.get('settings'))!;
    expect([s.defaultView, s.readerTheme, s.defaultProgressMode, s.defaultPageMode]).toEqual(['reflow', 'sepia', 'marked', 'scroll']);
  });
});
