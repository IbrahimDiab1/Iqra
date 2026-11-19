import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SettingsService } from '../core/settings.service';
import type { Settings } from '../core/models';
import { SETTINGS_COPY } from './settings-copy';

interface Group {
  key: 'defaultView' | 'readerTheme' | 'defaultProgressMode' | 'defaultPageMode' | 'weekStartsOn';
  label: string;
  options: readonly { value: Settings[Group['key']]; label: string }[];
}

const C = SETTINGS_COPY.defaults;

const GROUPS: readonly Group[] = [
  { key: 'defaultView', label: C.view, options: [{ value: 'page', label: C.page }, { value: 'reflow', label: C.reflow }] },
  { key: 'readerTheme', label: C.color, options: [{ value: 'paper', label: C.paper }, { value: 'sepia', label: C.sepia }, { value: 'night', label: C.night }] },
  { key: 'defaultProgressMode', label: C.progress, options: [{ value: 'last-page', label: C.lastPage }, { value: 'marked', label: C.marked }] },
  { key: 'defaultPageMode', label: C.pageMode, options: [{ value: 'swipe', label: C.swipe }, { value: 'scroll', label: C.scroll }] },
  { key: 'weekStartsOn', label: C.weekStart, options: [{ value: 6, label: C.sat }, { value: 0, label: C.sun }, { value: 1, label: C.mon }] },
];

/** Reading defaults, saved in the synced Settings record. */
@Component({
  selector: 'iqra-defaults-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="hint">{{ c.hint }}</p>
    @for (g of groups; track g.key) {
      <span class="lbl" [id]="'def-' + g.key">{{ g.label }}</span>
      <div class="seg" role="group" [attr.aria-labelledby]="'def-' + g.key" [attr.data-group]="g.key">
        @for (o of g.options; track o.value) {
          <button type="button" [attr.aria-pressed]="settings.settings()[g.key] === o.value" (click)="choose(g.key, o.value)">{{ o.label }}</button>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .hint { margin: 0 0 4px; font-size: 13px; color: var(--muted); }
    .lbl { display: block; margin: 14px 0 6px; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    .seg { display: flex; background: var(--surface-2); border-radius: var(--radius-control); padding: 3px; gap: 2px; }
    .seg button { flex: 1; min-height: 40px; border: 0; background: none; border-radius: 9px; font: 500 13px var(--ui); color: var(--muted); cursor: pointer; }
    .seg button[aria-pressed='true'] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class DefaultsSection {
  protected readonly settings = inject(SettingsService);
  protected readonly c = C;
  protected readonly groups = GROUPS;

  protected choose(key: Group['key'], value: Settings[Group['key']]): void {
    void this.settings.update({ [key]: value });
  }
}
