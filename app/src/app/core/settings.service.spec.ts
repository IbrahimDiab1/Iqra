import { TestBed } from '@angular/core/testing';
import { CLOCK } from './clock';
import { DB, IqraDb } from './db';
import { newId } from './ids';
import { DEFAULT_SETTINGS, SettingsService } from './settings.service';

describe('SettingsService', () => {
  let db: IqraDb;
  let service: SettingsService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useFactory: () => new IqraDb(`iqra-test-${newId()}`) },
        { provide: CLOCK, useValue: { now: () => 1000 } },
      ],
    });
    db = TestBed.inject(DB);
    service = TestBed.inject(SettingsService);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.delete();
  });

  it('serves the defaults with id settings until a record exists', async () => {
    expect(service.settings()).toMatchObject({
      ...DEFAULT_SETTINGS,
      id: 'settings',
    });
    expect(await db.settings.get('settings')).toBeUndefined();
  });

  it('has the owner defaults: week starts Saturday, scroll, last page, paper', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ weekStartsOn: 6, defaultPageMode: 'scroll', defaultProgressMode: 'last-page', readerTheme: 'paper' });
  });

  it('defaults the reader theme to night when the system prefers dark', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const dark = TestBed.runInInjectionContext(() => new SettingsService());
    expect(dark.settings().readerTheme).toBe('night');
  });

  it('update persists the patch and the signal follows', async () => {
    await service.update({ readerTheme: 'night' });

    const stored = await db.settings.get('settings');
    expect(stored).toMatchObject({ id: 'settings', readerTheme: 'night', defaultView: 'page' });
    await vi.waitFor(() => expect(service.settings().readerTheme).toBe('night'));
  });

  it('update keeps earlier patches when called twice in a row', async () => {
    await service.update({ readerTheme: 'sepia' });
    await service.update({ defaultView: 'reflow' });

    const stored = await db.settings.get('settings');
    expect(stored).toMatchObject({ readerTheme: 'sepia', defaultView: 'reflow' });
  });
});
