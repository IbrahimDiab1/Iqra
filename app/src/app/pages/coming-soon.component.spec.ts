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
          useValue: { snapshot: { data: { icon: 'notes', title: COPY.placeholder.notesTitle, text: COPY.placeholder.notesText, next: COPY.placeholder.notesNext } } },
        },
      ],
    });
    const fixture = TestBed.createComponent(ComingSoonPage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')!.textContent).toBe('Notes');
    expect(el.textContent).toContain(COPY.placeholder.notesText);
    expect(el.querySelector('.pill')!.textContent).toBe(COPY.placeholder.soon);
  });
});
