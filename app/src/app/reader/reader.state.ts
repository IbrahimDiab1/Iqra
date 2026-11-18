import { computed, signal } from '@angular/core';
import type { Book } from '../core/models';
import { JumpHistory, type Place } from './jump-history';
import type { PositionService, RestoredPosition } from './position.service';
import { clampZoom } from './zoom';

type View = 'page' | 'reflow';

const CHROME_TAP_GAP_MS = 350;
/** A place report closer than this to the last saved offset is not a change (the scroller reports on mount). */
const OFFSET_TOLERANCE = 0.005;

/** The reader's place, zoom, view and chrome visibility, plus jump history and position saving. */
export class ReaderState {
  readonly page = signal(1);
  readonly offset = signal(0);
  readonly zoom = signal(1);
  readonly view = signal<View>('page');
  readonly chrome = signal(true);
  readonly lastCustomZoom = signal(1);

  readonly place = computed<Place>(() => ({ page: this.page(), offset: this.offset() }));

  private readonly history = new JumpHistory();
  private readonly historyVersion = signal(0);
  readonly canBack = computed(() => (this.historyVersion(), this.history.canBack));
  readonly canForward = computed(() => (this.historyVersion(), this.history.canForward));

  /** The zoom of the view that is not showing. */
  private inactiveZoom = 1;
  /** What was last restored or handed to the position service. */
  private saved: { page: number; offset: number; zoom: number; view: View } | undefined;
  private lastChromeTap = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly book: Book,
    private readonly positions: PositionService,
  ) {}

  init(r: RestoredPosition): void {
    this.page.set(r.place.page);
    this.offset.set(r.place.offset);
    this.view.set(r.view);
    this.zoom.set(r.zoom);
    this.saved = { page: r.place.page, offset: r.place.offset, zoom: r.zoom, view: r.view };
    if (r.view === 'page' && r.zoom > 1.05) this.lastCustomZoom.set(r.zoom);
  }

  /** A page turn (swipe, keys, chevrons): not a jump. */
  pageChange(page: number): void {
    this.page.set(page);
    this.offset.set(0);
    this.save();
  }

  /** The scroller's reported place while scrolling. */
  placeChange(place: Place): void {
    this.page.set(place.page);
    this.offset.set(place.offset);
    this.save();
  }

  /** A jump (outline, search, slider, other-device Back): remembers where it left from. */
  jumpTo(place: Place): void {
    this.history.push(this.place());
    this.historyVersion.update((v) => v + 1);
    this.setPlace(place);
  }

  historyBack(): Place | null {
    const place = this.history.back(this.place());
    this.historyVersion.update((v) => v + 1);
    if (place) this.setPlace(place);
    return place;
  }

  historyForward(): Place | null {
    const place = this.history.forward(this.place());
    this.historyVersion.update((v) => v + 1);
    if (place) this.setPlace(place);
    return place;
  }

  setZoom(z: number): void {
    const zoom = clampZoom(z, this.view());
    this.zoom.set(zoom);
    if (this.view() === 'page' && zoom > 1.05) this.lastCustomZoom.set(zoom);
    this.save();
  }

  /** Switches view, keeping the place and each view's own zoom. */
  setView(view: View): void {
    if (view === this.view()) return;
    const previous = this.zoom();
    this.zoom.set(this.inactiveZoom);
    this.inactiveZoom = previous;
    this.view.set(view);
    this.save();
  }

  /** Shows or hides the bars; a tap right after another (a double tap) is ignored. */
  toggleChrome(): void {
    const now = performance.now();
    const ignore = now - this.lastChromeTap < CHROME_TAP_GAP_MS;
    this.lastChromeTap = now;
    if (!ignore) this.chrome.update((c) => !c);
  }

  /** Writes the pending position now; failures are logged, never thrown. */
  async flush(): Promise<void> {
    try {
      await this.positions.flush();
    } catch (err) {
      console.warn('Could not save the reading position', err);
    }
  }

  private setPlace(place: Place): void {
    this.page.set(place.page);
    this.offset.set(place.offset);
    this.save();
  }

  private save(): void {
    const now = { page: this.page(), offset: this.offset(), zoom: this.zoom(), view: this.view() };
    const was = this.saved;
    // Only a real change is saved: re-reporting the restored place must not stamp a newer position.
    if (
      was &&
      was.page === now.page &&
      was.view === now.view &&
      was.zoom === now.zoom &&
      Math.abs(was.offset - now.offset) < OFFSET_TOLERANCE
    ) {
      return;
    }
    this.saved = now;
    this.positions.schedule(this.book, now);
  }
}
