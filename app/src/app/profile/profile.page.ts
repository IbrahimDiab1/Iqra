import { ChangeDetectionStrategy, Component, DestroyRef, Directive, OnInit, ViewContainerRef, computed, inject, input, type Type } from '@angular/core';
import { Router } from '@angular/router';
import { AuthApi } from '../auth/auth.service';
import { ONBOARDING_COPY } from '../onboarding/onboarding-copy';
import { openIntro } from '../onboarding/open-intro';
import { SETTINGS_COPY } from '../settings/settings-copy';

interface SectionDef {
  id: string;
  title: string;
  load: () => Promise<Type<unknown>>;
}

/** Sections in screen order. Each loads on demand so its code stays out of the main bundle. */
const SECTIONS: readonly SectionDef[] = [
  { id: 'account', title: SETTINGS_COPY.sections.account, load: () => import('../settings/account.section').then((m) => m.AccountSection) },
  { id: 'appearance', title: SETTINGS_COPY.sections.appearance, load: () => import('../settings/appearance.section').then((m) => m.AppearanceSection) },
  { id: 'storage', title: SETTINGS_COPY.sections.storage, load: () => import('../settings/storage.section').then((m) => m.StorageSection) },
  { id: 'reminders', title: SETTINGS_COPY.sections.reminders, load: () => import('../settings/reminders.section').then((m) => m.RemindersSection) },
  { id: 'data', title: SETTINGS_COPY.sections.data, load: () => import('../settings/data.section').then((m) => m.DataSection) },
];

/** Loads a section's code on demand and renders it in place. */
@Directive({ selector: '[iqraSectionHost]' })
class SectionHost implements OnInit {
  readonly load = input.required<() => Promise<Type<unknown>>>({ alias: 'iqraSectionHost' });
  private readonly host = inject(ViewContainerRef);
  private created = false;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  ngOnInit(): void {
    void this.create();
  }

  private async create(): Promise<void> {
    const comp = await this.load()();
    // The page may have been left while the section's code was still loading.
    if (this.created || this.destroyed) return;
    this.created = true;
    this.host.createComponent(comp);
  }
}

/** The Profile tab: who is signed in, sync state, then the settings sections (account, appearance, storage, reminders, data). */
@Component({
  selector: 'iqra-profile-page',
  imports: [SectionHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="hdr">
        @if (picture(); as src) {
          <img class="avatar" data-testid="avatar" [src]="src" alt="" referrerpolicy="no-referrer" width="64" height="64" />
        } @else {
          <span class="avatar initial" data-testid="avatar" aria-hidden="true">{{ initial() }}</span>
        }
        <div class="who">
          <h1 dir="auto" data-testid="profile-name">{{ name() }}</h1>
          <p class="email" dir="auto" data-testid="profile-email">{{ email() }}</p>
        </div>
      </header>
      @for (s of sections; track s.id) {
        <section class="sec" [attr.data-section]="s.id" [attr.aria-labelledby]="'sec-' + s.id">
          <h2 [id]="'sec-' + s.id">{{ s.title }}</h2>
          <ng-container [iqraSectionHost]="s.load" />
        </section>
      }
      <button type="button" class="intro" data-testid="show-intro" (click)="showIntro()">{{ introLabel }}</button>
    </section>
  `,
  styles: `
    .page { padding: 20px var(--gutter) 24px; max-width: 720px; margin: 0 auto; }
    .hdr { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
    .avatar { flex: none; width: 64px; height: 64px; border-radius: 50%; object-fit: cover; background: var(--surface-2); }
    .initial { display: grid; place-items: center; background: var(--accent); color: var(--accent-fg); font-size: 26px; font-weight: 600; }
    .who { min-width: 0; }
    h1 { margin: 0; font-size: 22px; font-weight: 600; line-height: 1.2; overflow-wrap: anywhere; }
    .email { margin: 2px 0 0; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
    .intro { display: block; margin: 14px auto 0; min-height: 44px; padding: 0 14px; border: 0; border-radius: 12px; background: none; color: var(--accent); font: 600 14px var(--ui); cursor: pointer; }
    .intro:hover { background: var(--surface-2); }
    .intro:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .sec { margin-top: 14px; padding: 14px 16px 16px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
    h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  `,
})
export class ProfilePage {
  private readonly auth = inject(AuthApi);
  private readonly router = inject(Router);
  protected readonly introLabel = ONBOARDING_COPY.showIntro;
  private readonly vcr = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly sections = SECTIONS;
  protected readonly name = computed(() => this.auth.profile()?.name ?? SETTINGS_COPY.title);
  protected readonly email = computed(() => this.auth.profile()?.email ?? '');
  protected readonly picture = computed(() => this.auth.profile()?.picture ?? null);
  protected showIntro(): void {
    void openIntro(this.vcr, this.destroyRef, () => this.goToLibrary());
  }

  protected goToLibrary(): void {
    void this.router.navigateByUrl('/library');
  }
  protected readonly initial = computed(() => (this.auth.profile()?.name ?? '?').trim().charAt(0).toUpperCase() || '?');
}
