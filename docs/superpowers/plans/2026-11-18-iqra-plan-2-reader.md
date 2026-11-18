# Iqra Plan 2: The Reader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the page-1 stub with the real reader: page view and reading mode, swipe and continuous-scroll page modes, zoom, back/forward through jumps, opening at the last place across devices, contents and search in the book.

**Architecture:** A `PdfSession` wraps pdf.js for one open book (local blob or Drive stream) and exposes page sizes, canvas rendering and text. Pure functions (zoom math, jump history, gestures, virtualization, text reflow, search normalization) carry the logic and are unit-tested. Thin Angular components (`PageView`, `Pager`, `Scroller`, `ReflowView`) render, and `ReaderPage` composes them. Positions are saved locally and synced as `Position` records (one per device); the newest one wins on open.

**Tech Stack:** Angular 22 (standalone, signals), pdf.js (`pdfjs-dist`, lazy-loaded through `loadPdfjs()`), Dexie, Vitest (`npx ng test --watch=false`), Playwright e2e (`npm run e2e`, preinstalled Chromium).

**Spec:** `docs/specs/2026-11-14-iqra-design.md` §9.2 (idle rules are Plan 4, not here), §9.4, §9.5, §9.9 (Contents and Search tabs only), §10, §11 spikes 1, 2, 4, 6. Plan 1 is `docs/superpowers/plans/2026-11-14-iqra-plan-1-foundation-library.md`.

**Not in this plan** (later plans): text selection, highlights, notes, bookmarks, area highlights, summaries, the Notes tab (Plan 3); reading time, "Mark read", progress modes beyond `lastPageReached`, stats (Plan 4); settings screen (Plan 5). Search results jump to the page; drawing match highlights on the page needs the text layer and arrives with Plan 3.

## Global Constraints
- Everything in Plan 1's Global Constraints still applies: $0 cost, local-first UI, copy only from `ui/copy.ts`, colors only from tokens, `dir="auto"` on user text, 40 px touch targets, visible focus rings, reduced-motion respected (a global rule exists in `styles.css`), no confirmation dialogs for undoable actions.
- Zoom is a multiplier of fit-to-width: `1` = page fits the viewport width. Page view range `0.5`–`4`. Reading-mode text size range `0.8`–`2` (steps of `0.1`).
- Canvas rendering uses `devicePixelRatio` capped at `2`, and the canvas pixel area is capped at `16_000_000`; if exceeded, scale down until it fits.
- A page is "no text" when its extracted text has fewer than 10 non-whitespace characters.
- Position records: id `${bookId}:${deviceId}`; saved 800 ms after the last change and flushed on `visibilitychange` (hidden) and when leaving the reader. `offset` is 0..1 and clamped on read.
- `Book.lastPageReached` is raised to `max(current, page)` whenever the page changes (saved with the position flush). Book status `to-read` becomes `reading` on first open.
- Swipe: only when `zoom ≤ 1.05`; commit when `|dx| ≥ 25 %` of the width, or velocity `≥ 0.5 px/ms` with `|dx| ≥ 40 px`; ignore when `|dy| > |dx|`. Animation 220 ms ease-out. For `direction === 'rtl'` books swiping right goes to the next page.
- Performance: opening a downloaded 600-page PDF shows the first page in under 2 s; continuous mode renders only visible pages plus one viewport of overscan and frees off-screen canvases.
- The reader never runs pdf.js on the main thread beyond what pdf.js does itself (the worker is already configured).

## Review Focus
1. **A page with no text** (scanned book) in reading mode and in search: reading mode shows `COPY.reader.noText` and a "Show page" action; search skips it silently; nothing throws. Test in Tasks 2 and 11.
2. **A corrupt, password-protected or truncated PDF** opened from the library, and a **Drive stream that fails mid-way (offline)**: the reader shows the error state with Retry and Back, never an endless spinner; pages already painted stay visible. Test in Tasks 4 and 9.
3. **Rapid page flipping, rapid zoom changes and fast scrolling**: stale renders are cancelled, no page is left blank, and memory stays bounded (canvases freed). Test in Tasks 5 and 7.
4. **Arabic books**: swipe direction mirrored for `rtl`, search finds unvowelled text when the query has harakat and vice versa, and mixed Arabic/Latin titles render with `dir="auto"`. Test in Tasks 2, 6 and 10.
5. **Positions from two devices and out-of-range values** (a saved page larger than the book, `offset` outside 0..1, a deleted Position): open at the newest valid position, clamp the rest, never crash. Test in Task 3.

---

## File structure (relative to `app/`)

```
src/app/reader/
  reader.page.ts                 route component; composes everything (replaces reader-stub.page.ts)
  reader.state.ts                ReaderState (signals) + restore/save wiring
  pdf-session.ts                 PdfSession (open local/drive, sizes, render, text, destroy) + PageRenderer interface
  page-view.component.ts         one canvas page
  pager.component.ts             swipe mode
  scroller.component.ts          continuous mode
  reflow-view.component.ts       reading mode
  zoom-gestures.directive.ts     pinch, ctrl+wheel, double-tap
  book-panel.sheet.ts            Contents + Search sheet
  reading-settings.sheet.ts      view / page mode / theme / zoom
  zoom.ts, jump-history.ts, gestures.ts, virtualize.ts, outline.ts   pure helpers
  text.ts                        normalization, search, reflow
  search.service.ts              page-by-page search over a PdfSession
src/app/core/settings.service.ts SettingsService (defaults + live signal)
src/app/reader/position.service.ts PositionService
e2e/reader.spec.ts
```

---

### Task 1: Pure helpers — zoom, jump history, gestures, virtualization, outline

**Files:** Create `reader/zoom.ts`, `reader/jump-history.ts`, `reader/gestures.ts`, `reader/virtualize.ts`, `reader/outline.ts` and a `.spec.ts` beside each.

**Interfaces — Produces:**
```ts
// zoom.ts
export const PAGE_ZOOM = { min: 0.5, max: 4, steps: [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] } as const;
export const TEXT_ZOOM = { min: 0.8, max: 2, step: 0.1 } as const;
export function clampZoom(z: number, view: 'page' | 'reflow'): number;
export function zoomIn(z: number, view: 'page' | 'reflow'): number;     // page: next step above z; reflow: +0.1 (rounded to 1 decimal)
export function zoomOut(z: number, view: 'page' | 'reflow'): number;    // page: next step below z; reflow: -0.1
export function toggleFit(current: number, lastCustom: number): number; // |current-1|>0.01 → 1; else lastCustom if > 1.05 else 2
export function pinchZoom(startZoom: number, startDist: number, curDist: number): number; // startZoom*curDist/startDist, clamped for 'page'
export function fitScale(pageWidthPt: number, containerWidthPx: number): number;          // containerWidthPx / pageWidthPt
export function canvasScale(cssScale: number, pageWpt: number, pageHpt: number, dpr: number): number; // cssScale*min(dpr,2), reduced so (w*s)*(h*s) <= 16_000_000
// jump-history.ts
export interface Place { page: number; offset: number }
export class JumpHistory {
  push(from: Place): void;                    // clears forward; ignores a place equal (same page) to the top; max 50 entries
  back(current: Place): Place | null;         // pops, pushes current onto forward
  forward(current: Place): Place | null;
  get canBack(): boolean; get canForward(): boolean;
  clear(): void;
}
// gestures.ts
export type SwipeResult = 'next' | 'prev' | 'stay';
export function resolveSwipe(o: { dx: number; dy: number; dtMs: number; width: number; zoom: number; rtl: boolean }): SwipeResult;
// virtualize.ts
export function visibleRange(o: { scrollTop: number; viewportH: number; tops: number[]; heights: number[]; overscanPx: number }): { first: number; last: number }; // inclusive indexes of pages intersecting [scrollTop-overscan, scrollTop+viewportH+overscan]
export function currentPageAt(o: { scrollTop: number; viewportH: number; tops: number[]; heights: number[] }): { index: number; offset: number }; // page covering the viewport center; offset = (scrollTop - top)/height clamped 0..1
// outline.ts
import type { OutlineNode } from '../core/models';
export function flattenOutline(nodes: OutlineNode[]): { node: OutlineNode; depth: number }[];
export function chapterTitleAt(nodes: OutlineNode[], page: number): string | null; // deepest... no: the top-level node with the greatest page <= page
```

- [ ] **Step 1: Write the failing tests** (names and exact assertions):
  - `zoom.spec`: `zoomIn(1,'page')===1.25`, `zoomIn(4,'page')===4`, `zoomOut(1,'page')===0.75`, `zoomOut(0.5,'page')===0.5`, `zoomIn(1.1,'page')===1.25`, `zoomIn(1,'reflow')===1.1`, `zoomOut(0.8,'reflow')===0.8`, `toggleFit(1.5,1.5)===1`, `toggleFit(1,1.5)===1.5`, `toggleFit(1,1)===2`, `pinchZoom(1,100,200)===2`, `pinchZoom(1,100,1000)===4`, `fitScale(600,300)===0.5`, `canvasScale(1,612,792,2)===2`, and for a huge page `canvasScale(4,2000,3000,2)*2000 * (canvasScale(4,2000,3000,2)*3000) <= 16_000_000`.
  - `jump-history.spec`: push A, push B, back(C) returns B and `canForward`; forward(B) returns C; push after back clears forward; pushing the same page as the top is ignored; 51 pushes keep 50.
  - `gestures.spec` (width 400): `dx=-120,dy=10,dtMs=300,zoom=1` → `'next'`; `dx=120` → `'prev'`; same with `rtl:true` swapped; `dx=-60,dtMs=300` → `'stay'`; `dx=-50,dtMs=50` (velocity 1 px/ms) → `'next'`; `dx=-30,dtMs=20` → `'stay'` (below 40 px); `dx=-200,dy=300` → `'stay'`; `zoom=1.5` → `'stay'`.
  - `virtualize.spec`: 10 pages each 100 tall with 10 gap (`tops=[0,110,…]`): `scrollTop=0,viewportH=250,overscan=0` → `{first:0,last:2}`; `scrollTop=550` → first 4 (top 440..540? compute from tops) — write assertions from the arrays; `currentPageAt({scrollTop:100,viewportH:200,…})` → index 1 (center 200 is inside page 1 spanning 110–210), offset ≈ `(100-110)/100` clamped to 0.
  - `outline.spec`: `chapterTitleAt` with nodes at pages 1, 20, 50: page 19 → first title, page 20 → second, page 0 → null; `flattenOutline` returns depth-first with depth numbers.
- [ ] **Step 2:** Run `npx ng test --watch=false --include 'src/app/reader/**/*.spec.ts'`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the functions to the signatures above (plain TypeScript, no Angular).
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: reader pure helpers`.

### Task 2: Text pipeline — normalization, search matching, reflow

**Files:** Create `reader/text.ts`, `reader/text.spec.ts`.

**Interfaces — Produces:**
```ts
export interface TextItem { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean } // pdf.js text item subset
export function normalizeWithMap(s: string): { text: string; map: number[] };
  // lowercases; strips Latin combining marks (NFD); strips Arabic harakat U+064B–U+065F, U+0670 and tatweel U+0640;
  // maps أ إ آ ٱ → ا, ى → ي, ة → ه; collapses runs of whitespace to one space; map[i] = index in the ORIGINAL string of normalized char i.
export function findMatches(pageText: string, query: string, max?: number): { index: number; length: number }[]; // indexes/lengths in ORIGINAL text; query normalized the same way; empty/1-char query → []
export function snippet(pageText: string, m: { index: number; length: number }, ctx?: number): { before: string; match: string; after: string }; // ctx default 40 chars each side, trimmed, with '…' when cut
export function pageTextOf(items: TextItem[]): string;      // item strs joined with ' ' (a hasEOL item joins with '\n'), whitespace collapsed
export function hasSelectableText(items: TextItem[]): boolean; // ≥ 10 non-whitespace chars in total
export interface Paragraph { text: string; rtl: boolean }
export function buildReflow(items: TextItem[], opts: { rtl: boolean }): Paragraph[];
```
**buildReflow algorithm (exact):** drop empty items; font height `h = item.height || |transform[3]|`; group into lines: sort by `y = transform[5]` descending, then items with `|y - lineY| ≤ 0.5·h` belong to the same line; inside a line order by `x = transform[4]` ascending for LTR text and descending when `opts.rtl` (for Arabic lines pdf.js already gives visual runs); join a line's items with `' '` collapsing double spaces. Start a new paragraph when the gap to the previous line `> 1.6 ×` the median line spacing of the page, or when the previous line is shorter than 60 % of the longest line AND ends with `.`, `؟`, `!`, `?` or `:`. Join lines inside a paragraph with a space, except when a line ends with `-` preceded by a Latin letter and the next starts with a lowercase Latin letter: remove the hyphen and join with no space. `rtl` flag per paragraph: true when ≥ 30 % of its letters are Arabic (`؀-ۿ`, `ﭐ-﷿`, `ﹰ-﻿`).

- [ ] **Step 1: Write the failing tests** (`text.spec.ts`), exact cases:
  - `normalizeWithMap('Café')` → text `'cafe'`, `map` length 4 and `map[3]===3`.
  - `normalizeWithMap('مُحَمَّد')` → text `'محمد'`; `findMatches('قال محمد اليوم','مُحَمَّد')` → `[{index:4,length:4}]`; reverse (vowelled page text, bare query) finds the same word; `findMatches('أحمد', 'احمد')` finds it; `'مدرسة'` found by query `'مدرسه'`.
  - `findMatches('The Species species','species')` → two matches (case-insensitive); `findMatches('abc','a')` → `[]`; `max` caps results.
  - `snippet` adds `'…'` only on the cut sides and trims whitespace.
  - `hasSelectableText([])` false; `hasSelectableText([{str:'  ',…}])` false; ≥10 chars true.
  - `buildReflow` with two same-y items `[{str:'Hello',transform:[1,0,0,10,10,700]},{str:'world',transform:[1,0,0,10,60,700]}]` → one paragraph `'Hello world'`; two lines 12 apart → one paragraph; a gap of 40 → two paragraphs; `'exam-'` then `'ple text'` → `'example text'`; an RTL page with items at x=300 and x=100 on the same line, `rtl:true` → text starts with the x=300 item; Arabic paragraph has `rtl:true`, Latin has `false`; `buildReflow([], …)` → `[]`.
- [ ] **Step 2:** Run `npx ng test --watch=false --include 'src/app/reader/text.spec.ts'`. Expected: FAIL.
- [ ] **Step 3:** Implement in `reader/text.ts`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: reader text pipeline`.

### Task 3: PositionService and SettingsService

**Files:** Create `reader/position.service.ts` (+spec), `core/settings.service.ts` (+spec). Modify `reader/…` none.

**Interfaces:**
- Consumes: `Repo`, `DB` (`db.positions`, `db.books`, `db.settings`), `CLOCK`, `DEVICE_ID` (core/ids.ts), `ToastService`.
- Produces:
```ts
// settings.service.ts
export const DEFAULT_SETTINGS: Omit<Settings, keyof SyncMeta>;  // defaultProgressMode 'last-page', defaultPageMode 'swipe', defaultView 'page', readerTheme 'paper', weekStartsOn 6, reminders {}, cardDirection 'en-ar'
export class SettingsService {
  settings: Signal<Settings>;                       // live; DEFAULT_SETTINGS (+id 'settings') until a record exists; the readerTheme default is 'night' when matchMedia('(prefers-color-scheme: dark)').matches
  update(patch: Partial<Omit<Settings, keyof SyncMeta>>): Promise<void>;   // repo.put('settings', {...current, ...patch, id: 'settings'})
}
// position.service.ts
export interface RestoredPosition { place: Place; zoom: number; view: 'page' | 'reflow'; fromOtherDevice: boolean; previousLocal?: Place }
export class PositionService {
  restore(book: Book): Promise<RestoredPosition>;           // newest non-deleted Position of the book; clamp page to 1..book.pageCount, offset to 0..1, zoom to the view's range; none → { place:{page:max(1,book.lastPageReached),offset:0}, zoom:1, view: settings.defaultView, fromOtherDevice:false }
  schedule(book: Book, p: { page: number; offset: number; zoom: number; view: 'page' | 'reflow' }): void;   // debounced 800 ms; also raises book.lastPageReached; the first call per open also sets book.lastOpenedAt = now and status 'to-read' → 'reading'
  flush(): Promise<void>;                                    // writes the pending state immediately (no-op if none)
}
```
`fromOtherDevice` is true when the newest Position's `deviceId` differs from this device's AND this device has its own Position for the book with a different page (that page is `previousLocal`).

- [ ] **Step 1: Write the failing tests** (FolioDb-style fresh Dexie per test, mutable clock as in `core/repo.spec.ts`):
  - `restore` with no Position → `place.page === max(1, lastPageReached)`, `fromOtherDevice:false`.
  - Two Positions (this device at t=1000 page 5, other device at t=2000 page 90) → `place.page===90`, `fromOtherDevice:true`, `previousLocal.page===5`.
  - **Review Focus 5:** a Position with page 9999 on a 300-page book → page 300; offset 5 → 1; offset -1 → 0; a soft-deleted newest Position is ignored.
  - `schedule` called 3 times within 800 ms (fake timers) → exactly one `positions` write holding the last values, id `${bookId}:${deviceId}`; `book.lastPageReached` is `max` of the pages; status `to-read` → `reading` and `lastOpenedAt` set once.
  - `flush()` writes immediately and clears the timer.
  - `SettingsService`: no record → defaults with `id:'settings'`; `update({readerTheme:'night'})` persists and the signal updates.
- [ ] **Step 2:** Run the two specs. Expected: FAIL.
- [ ] **Step 3:** Implement with `Repo.put`/`Repo.live`; use `setTimeout` (tests use fake timers).
- [ ] **Step 4:** Run the two specs. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: position and settings services`.

### Task 4: PdfSession

**Files:** Create `reader/pdf-session.ts` (+spec).

**Interfaces — Produces:**
```ts
export interface PageSize { widthPt: number; heightPt: number }
export interface PageRenderer {                      // what components depend on; tests provide a fake
  readonly numPages: number;
  pageSize(page: number): Promise<PageSize>;
  renderPage(page: number, canvas: HTMLCanvasElement, cssWidthPx: number, signal: AbortSignal): Promise<void>; // sets canvas.width/height from canvasScale(), draws; rejects with an AbortError-named error when aborted
  textItems(page: number): Promise<TextItem[]>;
  pageText(page: number): Promise<string>;           // cached pageTextOf
}
export class PdfSession implements PageRenderer {
  static open(src: { kind: 'local'; blob: Blob } | { kind: 'drive'; url: string; httpHeaders: Record<string, string> }): Promise<PdfSession>; // rejects with ReaderOpenError('corrupt' | 'password' | 'network')
  readonly numPages: number;
  destroy(): void;
}
export class ReaderOpenError extends Error { constructor(readonly reason: 'corrupt' | 'password' | 'network') }
```
Behavior: local → `getDocument({ data })`; drive → `getDocument({ url, httpHeaders, rangeChunkSize: 65536, disableAutoFetch: true })`. Map pdf.js `PasswordException` → `'password'`; `InvalidPDFException`/`FormatError`/`MissingPDFException` → `'corrupt'`; other failures (network, `UnexpectedResponseException`, `TypeError`) → `'network'`. Page sizes come from `page.getViewport({scale:1})` and are cached per page; `renderPage` computes `cssScale = cssWidthPx / widthPt`, `canvasScale(cssScale, w, h, devicePixelRatio)`, sets the canvas pixel size, calls `page.render({canvasContext, viewport})`, and cancels the pdf.js render task when the signal aborts. `textItems` uses `getTextContent()`; `pageText` caches `pageTextOf(items)` (up to 200 pages, then drops the oldest).

- [ ] **Step 1: Write the failing tests** with a stubbed `loadPdfjs` (inject via a module-level `setPdfjsLoaderForTests(fn)` export): (a) `open` local passes `{data}`; (b) drive passes `url`, `httpHeaders`, `rangeChunkSize:65536`, `disableAutoFetch:true`; (c) **Review Focus 2:** a stub throwing `{name:'PasswordException'}` → `ReaderOpenError` reason `'password'`; `{name:'InvalidPDFException'}` → `'corrupt'`; a `TypeError('Failed to fetch')` → `'network'`; (d) `pageSize` is fetched once per page (stub call count); (e) `renderPage` with an already-aborted signal rejects without calling `render`; aborting mid-render calls the stub task's `cancel()`; (f) `pageText` cache: second call does not call `getTextContent`.
- [ ] **Step 2:** Run `npx ng test --watch=false --include 'src/app/reader/pdf-session.spec.ts'`. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep one pdf.js `PDFDocumentProxy`; `destroy()` calls `doc.destroy()`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: pdf session`.

### Task 5: PageView component

**Files:** Create `reader/page-view.component.ts` (+spec). Add icons in Task 9, not here.

**Interfaces:** Consumes `PageRenderer`, `PAGE_ZOOM`. Produces `<iqra-page-view [renderer] [page] [fitWidthPx] [zoom] [theme] (rendered)>`.

Behavior: css width = `fitWidthPx × zoom`; css height = width × (heightPt/widthPt) once `pageSize` resolves (until then a skeleton block using the previous page's ratio or `1.414`). Renders into a `<canvas>`: on every change of `page`, `fitWidthPx` or `zoom`, abort the previous render (AbortController) and start a new one (debounce 60 ms for zoom changes; page changes render immediately). While rendering the previous bitmap stays visible; a shimmer shows only before the first paint. A render that rejects with an abort error is ignored; any other failure shows `COPY.reader.pageFailed` with a Retry button. On destroy, abort and set `canvas.width = canvas.height = 0` (frees memory). Theme: `paper` none; `sepia` → CSS `filter: sepia(.35) contrast(.95)`; `night` → `filter: invert(1) hue-rotate(180deg) brightness(.92)`. Emits `(rendered)` with the page number after each completed render.

- [ ] **Step 1: Write the failing tests** with a fake `PageRenderer` (records calls; `renderPage` resolves after a manual trigger): (a) first render called with `cssWidthPx = fitWidthPx × zoom`; (b) changing `page` aborts the first render's signal and starts another; (c) **Review Focus 3:** 5 rapid page changes → only the last render's result emits `(rendered)`; (d) non-abort failure shows `COPY.reader.pageFailed` and Retry re-renders; (e) destroy aborts and zeroes the canvas size; (f) night theme sets the inverted filter style.
- [ ] **Step 2:** Run the spec. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: page view component`.

### Task 6: Pager (swipe mode)

**Files:** Create `reader/pager.component.ts` (+spec).

**Interfaces:** Consumes `PageView`, `resolveSwipe`, `PageRenderer`. Produces `<iqra-pager [renderer] [page] [zoom] [rtl] [theme] (pageChange)="n" (zoomChange)="z" (tap)>`.

Behavior: three slots (page−1, page, page+1; slots outside 1..numPages are empty) in a track; the viewport `fitWidthPx` is the container width. Pointer events on the track: when `zoom ≤ 1.05` a horizontal drag moves the track with the finger (`translateX`); on release `resolveSwipe` decides: `'next'`/`'prev'` animate (220 ms) and emit `pageChange(page±1)` (clamped), `'stay'` snaps back. For `rtl` the track order is mirrored (`next` is to the left… the next page enters from the left edge; swiping right = next). When `zoom > 1.05` the slot area is a scrollable pan container (overflow auto) and horizontal drags pan instead of paging; arrow keys then scroll. Keys: `ArrowRight`/`ArrowLeft` (swapped for rtl), `PageDown`/`PageUp`, `Space` = next, `Shift+Space` = prev, only when no input/textarea is focused. A pointer interaction that moved less than 6 px and lasted less than 300 ms emits `(tap)`. Pointer capture is used; touch-action is `pan-y` (so vertical page scroll when zoomed still works) when zoom ≤ 1.05 and `auto` when zoomed.

- [ ] **Step 1: Write the failing tests** (fake renderer, synthetic `PointerEvent`s): (a) drag −120 px on a 400 px viewport → `pageChange(page+1)`; (b) same with `rtl` → `pageChange(page-1)` when dragging left, and `+1` when dragging right; (c) drag −40 px slowly → no emit and the track returns to 0; (d) at page 1, a `'prev'` swipe emits nothing; at the last page, `'next'` emits nothing; (e) `zoom=2` → drag does not emit; (f) `ArrowRight` → next (rtl: prev); (g) a tap (down/up within 6 px, 100 ms) emits `(tap)` once; (h) **Review Focus 4:** rtl track order assertion (next slot is positioned on the left).
- [ ] **Step 2:** Run the spec. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: swipe pager`.

### Task 7: Scroller (continuous mode) and zoom gestures

**Files:** Create `reader/scroller.component.ts`, `reader/zoom-gestures.directive.ts` (+specs).

**Interfaces:** Consumes `visibleRange`, `currentPageAt`, `PageView`, `pinchZoom`, `toggleFit`, `zoomIn`, `zoomOut`. Produces:
```ts
<iqra-scroller [renderer] [startPlace] [zoom] [theme] (placeChange)="Place" (zoomChange)="z" (tap)>
  // vertical list of pages, gap 12px, virtualized; scrollTo(place: Place) public method used for jumps
[iqraZoomGestures] [zoom] [view] [lastCustomZoom] (zoomChange)="z"   // directive on a container
```
Scroller behavior: needs all page heights: it asks `renderer.pageSize(1)` first and uses its aspect for every unknown page, replacing each height when that page's size resolves (preserving the visual anchor by adjusting `scrollTop`); tops are prefix sums with the 12 px gap; on scroll (rAF-throttled) compute `visibleRange` with `overscanPx = viewportH` and render only those pages (others are empty boxes of the right height); emit `placeChange` from `currentPageAt` (debounced 100 ms); on init scroll to `startPlace` (page top + offset × height) once heights are known. `scrollTo` places the page at the top. Zoom changes keep the viewport-center anchor (same page offset).
Directive behavior: two touch pointers → `pinchZoom` (emit continuously, throttled to rAF); `ctrl+wheel` → `zoomIn`/`zoomOut` (prevent default); double-click/double-tap (two taps within 300 ms and 30 px) → `toggleFit(zoom, lastCustomZoom)`; keyboard `Ctrl+=`/`Ctrl+-`/`Ctrl+0` when focus is not in an input.

- [ ] **Step 1: Write the failing tests:** Scroller (fake renderer with 100 pages): (a) after init only pages within the visible range plus overscan have a rendered `iqra-page-view`; (b) scrolling by 5000 px updates the rendered set and emits `placeChange` with the expected page; (c) **Review Focus 3:** a fast scroll through 50 pages leaves at most `visible + overscan` canvases alive (count `iqra-page-view` elements); (d) `startPlace {page:40, offset:0.5}` → `scrollTop` equals `tops[39] + 0.5×heights[39]` (within 1 px); (e) changing `zoom` from 1 to 2 keeps `currentPageAt` index unchanged. Directive: (f) two-pointer pinch from 100 px to 200 px at zoom 1 emits 2; (g) `ctrl+wheel` deltaY<0 emits `zoomIn(zoom)` and calls `preventDefault`; (h) a double tap at zoom 1.5 with `lastCustomZoom 1.5` emits 1; at zoom 1 emits 1.5.
- [ ] **Step 2:** Run the specs. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the specs. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: continuous scroller and zoom gestures`.

### Task 8: Reflow view (reading mode)

**Files:** Create `reader/reflow-view.component.ts` (+spec).

**Interfaces:** Consumes `PageRenderer.textItems`, `buildReflow`, `hasSelectableText`. Produces `<iqra-reflow-view [renderer] [page] [zoom] [rtl] [theme] (pageChange)="n" (showPage)="void" (tap)>`.

Behavior: loads `textItems(page)`; if `!hasSelectableText` shows `COPY.reader.noText` and a `COPY.reader.showPage` button that emits `(showPage)`; otherwise renders paragraphs in the book serif (`--book`), `font-size: calc(17px × zoom)`, line-height 1.7, max-width 560 px centered, each paragraph `dir` from `Paragraph.rtl` (`rtl`/`ltr`), `lang="ar"` when rtl; theme colors from the `--paper-*`/`--ink-*` tokens. At the end of the text, a "Next page" button (`COPY.reader.nextPage`) and at the start a "Previous page" button emit `pageChange`. Scroll position resets to the top on page change. A failed `textItems` shows `COPY.reader.pageFailed`.

- [ ] **Step 1: Write the failing tests** (fake renderer returning scripted items): (a) two paragraphs render as two `<p>`; (b) an Arabic paragraph gets `dir="rtl"`; (c) **Review Focus 1:** an empty page shows `COPY.reader.noText` and clicking the button emits `(showPage)`; (d) next/prev buttons emit `pageChange(page±1)` and are absent at the ends; (e) `zoom=1.5` sets `font-size: 25.5px`.
- [ ] **Step 2:** Run the spec. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: reading mode view`.

### Task 9: ReaderPage shell

**Files:** Create `reader/reader.page.ts`, `reader/reader.state.ts` (+spec). Modify `app.routes.ts` (route `read/:bookId` → `ReaderPage`), `ui/icons.ts` (add `histBack`: `<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>`, `histFwd`: mirrored `<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>`, `zoomIn`: `<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8v6M8 11h6"/>`, `zoomOut`: `<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8 11h6"/>`), `ui/copy.ts` (`COPY.reader`, below), `ui/toast.service.ts` (`actionLabel?: string` in `show` options; the button shows it instead of "Undo"; default stays `COPY.common.undo`; test added). Delete `reader/reader-stub.page.ts`.

**COPY.reader (exact; replaces the old `reader` object, keeping `loading`, `failed`, `back`):**
```ts
reader: {
  loading: 'Loading…', failed: 'This book couldn’t be opened.', back: 'Back to library', retry: 'Try again',
  passwordFailed: 'This PDF is password protected. Iqra can’t open it yet.',
  networkFailed: 'Couldn’t load the book. Check your connection and try again.',
  pageFailed: 'This page couldn’t be drawn.', noText: 'This page has no selectable text.', showPage: 'Show page',
  nextPage: 'Next page', prevPage: 'Previous page', contents: 'Contents', search: 'Search', settings: 'Reading settings',
  readingMode: 'Reading mode', pageView: 'Page view', jumpBack: 'Back', jumpForward: 'Forward',
  pageOf: (p: number, n: number) => `${p} of ${n}`, syncedFrom: (p: number) => `Synced from your other device · Back to p. ${p}`, backAction: 'Back',
  noContents: 'This PDF has no chapters.', searchPlaceholder: 'Search this book', searchHint: 'Type at least two letters.',
  searching: (done: number, total: number) => `Searching… ${done} of ${total} pages`, results: (n: number, capped: boolean) => capped ? `First ${n} results` : `${n} ${n === 1 ? 'result' : 'results'}`, noResults: 'No results.',
  view: 'View', pageMode: 'Turn pages by', swipe: 'Swiping', scroll: 'Scrolling', zoom: 'Zoom', textSize: 'Text size', pageColor: 'Page color', paper: 'Paper', sepia: 'Sepia', night: 'Night', saved: 'Saved'
}
```

**Behavior of `ReaderPage`:**
- Loads the book (`db.books`), then the source: local blob from `db.pdfFiles` when present, else `?source=drive` → `drive.mediaRequest(book.driveFileId)`; none available → error state. `PdfSession.open` errors map to `COPY.reader.failed` / `passwordFailed` / `networkFailed`; the error state has Retry and a Back-to-library link (40 px targets). Loading shows `COPY.reader.loading` with the logo-free minimal skeleton.
- `ReaderState` (signals): `page`, `offset`, `zoom`, `view`, `chrome` (bars visible; default true), `lastCustomZoom`. On open: `PositionService.restore`; if `fromOtherDevice` toast `COPY.reader.syncedFrom(previousLocal.page)` with `actionLabel: COPY.reader.backAction` whose action jumps back to `previousLocal` (a jump: pushes history).
- Layout (colors from tokens; `data-rt` theme attribute as in `folio-prototype.html`): top bar — back to library, title + `chapterTitleAt(book.outline, page)` (`dir="auto"`), history Back and Forward icon buttons (only enabled when `JumpHistory.canBack/canForward`; hidden when both are false), reading-mode/page-view toggle, search (opens the panel on Search), `type` icon (opens reading settings). Bottom bar — range slider 1..numPages (`oninput` previews the label, `change` jumps), previous/next chevrons, label `COPY.reader.pageOf` + percentage, and a "Contents" pill (opens the panel on Contents). Bars hide/show on `(tap)` with a 240 ms transform transition. Zoom +/− buttons appear inside the settings sheet and as a small floating pair at the lower right on desktop widths (≥ 900 px).
- Navigation: page changes from `pageChange` (swipe, keys, chevrons) do not touch history; **jumps** (slider release, outline tap, search result, `fromOtherDevice` Back, history buttons use their own stack) call `jumpTo(place)`: `history.push(current)`, then set the place and, in scroll mode, call `scroller.scrollTo`. History buttons and `Alt+ArrowLeft`/`Alt+ArrowRight` call `history.back/forward`. Every place/zoom/view change calls `PositionService.schedule`; `visibilitychange` (hidden) and `ngOnDestroy` call `flush()`.
- Mode switching: `Book.pageMode` (`swipe` → `iqra-pager`, `scroll` → `iqra-scroller`) per book; `view === 'reflow'` shows `iqra-reflow-view` instead (its `(showPage)` sets `view` to `'page'` for the current page). Switching preserves the place.
- Keyboard: Esc closes sheets; `ArrowLeft/Right`, `PageUp/Down` handled by the active child as in Tasks 6–8.
- The `iqraZoomGestures` directive wraps the page area in page view.

- [ ] **Step 1: Write the failing tests** (`reader.state.spec.ts` for the state/jump logic and `reader.page.spec.ts` with a fake `PdfSession` provider): (a) open restores the newest position (stub PositionService) and shows that page in the label; (b) `jumpTo` pushes history and enables the Back button; Back returns to the previous place and enables Forward; a plain `pageChange` does not enable Back; (c) `fromOtherDevice` shows the toast with action label `Back`, and invoking it jumps to the previous local page; (d) **Review Focus 2:** `PdfSession.open` rejecting with `'password'` shows `COPY.reader.passwordFailed`, rejecting with `'network'` shows `networkFailed` with a Retry that calls `open` again, and no loading text remains; (e) tapping the page toggles the `immersive` class; (f) page changes call `PositionService.schedule` and leaving the page calls `flush`; (g) `Book.pageMode = 'scroll'` renders `iqra-scroller`, `'swipe'` renders `iqra-pager`, `view='reflow'` renders `iqra-reflow-view`; (h) ToastService: `show('x', { undo: fn, actionLabel: 'Back' })` renders `Back`.
- [ ] **Step 2:** Run `npx ng test --watch=false --include 'src/app/reader/reader.*.spec.ts' --include 'src/app/ui/toast.service.spec.ts'`. Expected: FAIL.
- [ ] **Step 3:** Implement the page, state and the small toast/icons/copy changes; remove the stub and fix imports/routes.
- [ ] **Step 4:** Run the same command and then the full unit suite and `npx ng build`. Expected: PASS, no budget warning (the reader must be lazy-loaded with `loadComponent` in the route).
- [ ] **Step 5:** Commit: `feat: reader page`.

### Task 10: Contents and Search sheet

**Files:** Create `reader/book-panel.sheet.ts`, `reader/search.service.ts` (+specs).

**Interfaces:**
```ts
export interface SearchHit { page: number; before: string; match: string; after: string }
export class SearchService {
  search(r: PageRenderer, query: string, o: { max?: number; signal: AbortSignal; onProgress: (done: number, total: number) => void; onHit: (h: SearchHit) => void }): Promise<{ capped: boolean }>; // pages 1..n sequentially via r.pageText; skips pages with no text; query < 2 chars → resolves immediately with no hits; max default 300; stops when aborted
}
```
Sheet (tall sheet using `f-sheet`): two tabs `COPY.reader.contents` / `COPY.reader.search` (segmented, `role="tablist"`). **Contents:** `flattenOutline(book.outline)` as an indented list (depth × 16 px), the current chapter highlighted (`color: var(--accent)`, `font-weight: 600`), each row a 40 px+ button with title (`dir="auto"`) and page number at the end; tapping closes the sheet and calls `jumpTo({page, offset:0})`; nested nodes are always expanded in this plan; empty outline → `COPY.reader.noContents`. **Search:** a search field (`COPY.reader.searchPlaceholder`, `type=search`, `dir="auto"`, autofocus when opened on this tab), debounce 300 ms, a progress line `COPY.reader.searching(done,total)` while running and the count line `COPY.reader.results(n, capped)` after, a list of hits (page label `p. N` + snippet with the match in `<mark>`), `COPY.reader.noResults`, hint `COPY.reader.searchHint` for < 2 letters. A new query aborts the previous search. Tapping a hit closes the sheet and jumps to its page.

- [ ] **Step 1: Write the failing tests:** SearchService with a fake renderer of 4 pages (`['The origin of species','nothing','','Species and origin']`, page 3 empty): `'species'` → hits on pages 1 and 4, `onProgress` last call `(4,4)`, no throw for page 3 (**Review Focus 1**); `'x'` → no hits; `max:1` → one hit and `capped:true`; abort after the first page stops further `pageText` calls; **Review Focus 4:** an Arabic fake page `'قال مُحَمَّد اليوم'` found by query `'محمد'`. Sheet: Contents renders rows with indentation, highlights the current chapter, and tapping calls the jump callback with the page; empty outline shows `COPY.reader.noContents`; Search tab typing 'species' (fake timers) shows two hits with `<mark>`; typing a new query aborts the previous.
- [ ] **Step 2:** Run the specs. Expected: FAIL.
- [ ] **Step 3:** Implement; wire the sheet into `ReaderPage` (Contents pill, search icon, `Ctrl+F` when the reader is focused opens Search).
- [ ] **Step 4:** Run the specs and the full suite. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: contents and search sheet`.

### Task 11: Reading settings sheet

**Files:** Create `reader/reading-settings.sheet.ts` (+spec); modify `reader/reader.page.ts` to open it.

**Interfaces:** Consumes `SettingsService`, `Repo` (Book), `zoomIn/zoomOut`. Behavior: sheet titled `COPY.reader.settings` with segmented controls: **View** (`COPY.reader.pageView` / `COPY.reader.readingMode`, writes `Position.view` through the reader state), **Turn pages by** (`COPY.reader.swipe` / `COPY.reader.scroll`, writes `Book.pageMode` with `repo.put`), **Page color** (`paper`/`sepia`/`night`, writes `SettingsService.update({readerTheme})`), and a stepper (`A−`/`A+` 40 px buttons with a `%` label) labelled `COPY.reader.zoom` in page view or `COPY.reader.textSize` in reading mode. Changes apply immediately and show nothing else (no toast); the open sheet re-renders the segmented state.

- [ ] **Step 1: Write the failing tests:** each control writes the right record (Book.pageMode, Settings.readerTheme) and updates the reader state; the stepper label switches with the view; `A+` at max zoom is disabled; copy comes from `COPY.reader`.
- [ ] **Step 2:** Run the spec. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it and the full suite. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: reading settings sheet`.

### Task 12: End-to-end reader tests (real pdf.js)

**Files:** Create `e2e/reader.spec.ts`; extend `e2e/fixtures/make-fixtures.mjs` to also write `outline.pdf` (12 pages, text `Chapter N, page P`, with a two-level outline via pdf-lib's low-level API: chapters at pages 1, 5, 9) and `arabic.pdf` is NOT generated (no Arabic font embedding); Arabic coverage stays in unit tests and the manual checklist.

- [ ] **Step 1: Write the tests** (`npm run e2e` serves with the e2e config; use the Add PDF input then open the book):
  1. *opens and paints:* canvas on the page has non-blank pixels (read `getImageData` and check that more than 1 % are non-white).
  2. *swipe and keys:* `ArrowRight` shows `2 of 12`; `ArrowLeft` returns.
  3. *scroll mode:* switch Turn pages by → Scrolling; scrolling to the bottom updates the label beyond page 5.
  4. *contents and history:* open Contents, tap the chapter at page 9 → label `9 of 12`; the history Back button appears; tapping it returns to the earlier page; `Alt+ArrowRight` goes forward again.
  5. *search:* open Search, type `Chapter 9` → a hit on page 9; tapping it jumps there.
  6. *reading mode:* toggle Reading mode → paragraphs contain `Chapter 9`; toggle back.
  7. *position persistence:* go to page 7, reload the app → reopening the book lands on `7 of 12`.
  8. *two devices:* context A reads to page 10 and syncs; copy `__iqraDrive` state to context B (existing helper pattern in `e2e/library.spec.ts`) where the book was read to page 2; open on B → label `10 of 12` and the toast text `Synced from your other device · Back to p. 2`; tapping `Back` lands on page 2.
  9. *broken book:* the open sheet's Download for a book whose stored blob is not a PDF (inject via `page.evaluate` into IndexedDB `pdfFiles`) shows `This book couldn’t be opened.` with a Retry and Back link (**Review Focus 2**).
- [ ] **Step 2:** Run `npm run e2e`. Expected: all pass (fix app bugs found; do not weaken a test; report any small wiring fixes).
- [ ] **Step 3:** Commit: `test: reader e2e`.

### Task 13: Docs and deploy checklist

**Files:** Modify `docs/deploy-and-test.md` (add "Reader checks"), `README.md` (status line and feature list).

- [ ] **Step 1:** Add to the checklist, as plain steps: open a normal PDF on the PC and the phone (page view, swipe, pinch zoom on Android, Ctrl+wheel on PC); an **Arabic PDF** (text selectable? reading mode order and joined letters; search with and without harakat; swipe direction); a **scanned / low-quality PDF** (reading mode shows "no selectable text" and "Show page"); a **large PDF** (600 pages, 40 MB: first page under 2 s, smooth scrolling in continuous mode); **stream from Drive** on mobile data; read to a page on one device and confirm the other device offers "Back to p. N".
- [ ] **Step 2:** Update README: move "Opening a book shows a placeholder viewer" to the real description; roadmap row for Plan 2 → done.
- [ ] **Step 3:** Commit: `docs: reader checks`.

---

## Self-review notes
- **Spec coverage:** §9.4 (open at newest position, other-device toast) → Tasks 3, 9, 12; §9.5 view/page modes/zoom/history/keys/tap/bars → Tasks 1, 5–9; search in book → 2, 10 (match drawing deferred to Plan 3, stated above); §9.9 Contents and Search tabs → 10 (Notes/Bookmarks tabs and summaries are Plan 3); settings for view/mode/theme → 11; spikes 1, 2, 4, 6 → manual checklist in Task 13 plus streaming already built in Plan 1; Review Focus items each map to a test.
- **Type consistency:** `Place {page, offset}` (Task 1) is used by `PositionService`, `ReaderState`, `Scroller.scrollTo` and the sheets; `PageRenderer` (Task 4) is the only dependency of the view components; `TextItem` (Task 2) matches pdf.js text items and is what `PdfSession.textItems` returns.
