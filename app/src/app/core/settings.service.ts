import { Injectable, Signal, computed, inject } from '@angular/core';
import { DB } from './db';
import type { Settings, SyncMeta } from './models';
import { Repo } from './repo';

const SETTINGS_ID = 'settings';

export const DEFAULT_SETTINGS: Omit<Settings, keyof SyncMeta> = {
  defaultProgressMode: 'last-page',
  defaultPageMode: 'scroll',
  defaultView: 'page',
  readerTheme: 'paper',
  weekStartsOn: 6,
  reminders: {},
  cardDirection: 'en-ar',
};

function defaultSettings(): Settings {
  const prefersDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    ...DEFAULT_SETTINGS,
    id: SETTINGS_ID,
    readerTheme: prefersDark ? 'night' : DEFAULT_SETTINGS.readerTheme,
    updatedAt: 0,
    deviceId: '',
  };
}

/** App settings. Serves the defaults until a settings record is written. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly stored = this.repo.live(() => this.db.settings.get(SETTINGS_ID));
  private readonly fallback = defaultSettings();

  readonly settings: Signal<Settings> = computed(() => this.stored() ?? this.fallback);

  /** Saves the given fields over the current settings. */
  async update(patch: Partial<Omit<Settings, keyof SyncMeta>>): Promise<void> {
    const current = (await this.db.settings.get(SETTINGS_ID)) ?? this.fallback;
    await this.repo.put<Settings>('settings', { ...current, ...patch, id: SETTINGS_ID });
  }
}
