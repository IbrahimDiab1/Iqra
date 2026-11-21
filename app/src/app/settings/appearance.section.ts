import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SettingsService } from '../core/settings.service';

@Component({
  selector: 'iqra-appearance-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label>
      Theme
      <select #themeSelect [value]="theme()" (change)="setTheme(themeSelect.value)">
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  `,
  styles: `
    label { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    select { min-height: 44px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: inherit; }
    select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class AppearanceSection {
  private readonly settings = inject(SettingsService);
  protected readonly theme = computed(() => this.settings.settings().appTheme ?? 'system');

  protected setTheme(value: string): void {
    if (value === 'light' || value === 'dark' || value === 'system') {
      void this.settings.update({ appTheme: value });
    }
  }
}
