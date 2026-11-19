import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { COPY } from '../ui/copy';
import { ComingSoonPage } from './coming-soon.component';

describe('ComingSoonPage', () => {
  it('shows the title, text and the Coming soon pill from route data', () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { icon: 'stats', title: COPY.placeholder.statsTitle, text: COPY.placeholder.statsText, next: COPY.placeholder.statsNext } } },
        },
      ],
    });
    const fixture = TestBed.createComponent(ComingSoonPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')!.textContent).toBe(COPY.placeholder.statsTitle);
    expect(el.textContent).toContain(COPY.placeholder.statsText);
    expect(el.querySelector('.pill')!.textContent).toBe(COPY.placeholder.soon);
  });
});
