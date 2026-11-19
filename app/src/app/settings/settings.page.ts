import { ChangeDetectionStrategy, Component, Directive, OnInit, ViewContainerRef, inject, input, type Type } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { icon } from '../ui/icons';
import { SETTINGS_COPY } from './settings-copy';

interface SectionDef {
  id: string;
  title: string;
  load: () => Promise<Type<unknown>>;
}

/** Sections in screen order. Each loads on demand so its code stays out of the main bundle. */
const SECTIONS: readonly SectionDef[] = [
  { id: 'account', title: SETTINGS_COPY.sections.account, load: () => import('./account.section').then((m) => m.AccountSection) },
  { id: 'defaults', title: SETTINGS_COPY.sections.defaults, load: () => import('./defaults.section').then((m) => m.DefaultsSection) },
];

/** Loads a section's code on demand and renders it in place. */
@Directive({ selector: '[iqraSectionHost]' })
class SectionHost implements OnInit {
  readonly load = input.required<() => Promise<Type<unknown>>>({ alias: 'iqraSectionHost' });
  private readonly host = inject(ViewContainerRef);
  private created = false;

  ngOnInit(): void {
    void this.create();
  }

  private async create(): Promise<void> {
    const comp = await this.load()();
    if (this.created) return;
    this.created = true;
    this.host.createComponent(comp);
  }
}

/** The Settings screen: a back arrow, a title and the section list. */
@Component({
  selector: 'iqra-settings-page',
  imports: [RouterLink, SectionHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="hdr">
        <a class="back" routerLink="/library" [attr.aria-label]="c.back" [innerHTML]="backIcon"></a>
        <h1>{{ c.title }}</h1>
      </header>
      @for (s of sections; track s.id) {
        <section class="sec" [attr.data-section]="s.id" [attr.aria-labelledby]="'sec-' + s.id">
          <h2 [id]="'sec-' + s.id">{{ s.title }}</h2>
          <ng-container [iqraSectionHost]="s.load" />
        </section>
      }
    </section>
  `,
  styles: `
    .page { padding: 16px var(--gutter) 24px; max-width: 720px; margin: 0 auto; }
    .hdr { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    h1 { margin: 0; font-family: var(--book); font-size: 28px; font-weight: 600; }
    .back { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--radius-control); color: var(--fg); }
    .back:hover { background: var(--surface-2); }
    .back:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .sec { margin-top: 22px; }
    h2 { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  `,
})
export class SettingsPage {
  protected readonly c = SETTINGS_COPY;
  protected readonly sections = SECTIONS;
  protected readonly backIcon = inject(DomSanitizer).bypassSecurityTrustHtml(icon('back', 22));
}
