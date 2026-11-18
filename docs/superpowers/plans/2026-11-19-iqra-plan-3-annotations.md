# Iqra Plan 3: Annotations and Notes hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reader highlight text, add notes, draw area highlights, keep side notes, summaries and bookmarks, browse them in the book panel, and search them across all books in the Notes tab.

**Architecture:** Annotations are `Annotation` records (already in the data model and already synced in `book-<id>.json`). A new `AnnotationService` is the only writer. A transparent pdf.js text layer sits over each page canvas so the browser's native selection works; the selection becomes a `TextAnchor` (item index + char offset, normalized rects computed from text-item geometry). A highlight layer draws rects (percent-positioned, so zoom never matters) under the text layer. Reading mode draws highlights by splitting paragraph text on the anchor's quote. Everything is local-first; sync needs no change.

**Tech Stack:** Angular 22 standalone + signals, Dexie via `Repo`, pdfjs-dist 6.5 `TextLayer`, Vitest, Playwright.

**Spec:** `docs/specs/2026-11-14-iqra-design.md` — §7 data model (Annotation, TextAnchor, Rect, SummaryScope), §9.5 Reader (selecting text, tapping highlights, area highlight), §9.6 anchoring, §9.9 book panel, §9.10 Notes hub. Reader code from Plan 2 lives in `app/src/app/reader/`.

## Global Constraints

- Copy only from `app/src/app/ui/copy.ts`; colors/spacing only from `ui/tokens.css` (`--hl-yellow|green|blue|pink` already exist in both themes). Touch targets ≥ 40 px, visible focus rings, `prefers-reduced-motion` respected.
- Annotation `type`s are exactly `'highlight' | 'note' | 'area' | 'side-note' | 'summary' | 'bookmark'`. Highlight/area colors are exactly `'yellow' | 'green' | 'blue' | 'pink'`. `Rect` values are 0..1 relative to the page, y measured from the top.
- All writes go through `Repo.put` / `Repo.softDelete` (never hard-delete). Deleting always shows an Undo toast (`ToastService.show(msg, {undo})`).
- Tags are lowercase-kebab via the existing `normalizeTag` (`books/details/book-details.sheet.ts`).
- Arabic text: any element showing user text uses `dir="auto"`; quote matching must treat Arabic digits and letters as ordinary characters.
- Out of scope (later plans): chapter progress bars and marked-mode checkboxes in Contents (Plan 4), the Arabic translate button in the selection toolbar (Language Notebook), export (Plan 5).
- Existing gates stay green: `npx ng test --watch=false`, `npx ng build` (initial bundle budget unchanged; new code is in the lazy reader chunk except the Notes hub, which is lazy-routed), `npm run e2e` with `--trace off`.

## Review Focus

1. A page with no text layer (scanned PDF): selecting does nothing, no crash; area highlight and bookmarks still work.
2. Arabic/RTL text: selection anchors, rects (right-to-left within an item), quote matching and highlight drawing in both page view and reading mode.
3. Overlapping or adjacent highlights merge into one without losing any note or tag; Undo restores the originals exactly.
4. Swipe/scroll/pinch gestures must not fire while a selection exists or while the area tool is active, and a tap on text must select a word instead of toggling the bars.
5. Deleting a book's annotations on two devices at once and editing the same note on two devices converge by the sync rule (newest `updatedAt` wins); deleted records never show anywhere.

---

## File Structure

| File | Responsibility |
|---|---|
| `annotations/annotation.service.ts` | CRUD, live queries, overlap-merge, undo helpers |
| `annotations/anchor.ts` | Pure: quote location, rect geometry, overlap, union, hit-test |
| `annotations/notes-search.ts` | Pure: filter/search/group annotations for the hub |
| `annotations/tag-input.component.ts` | Tag chips input with suggestions |
| `annotations/note-sheet.component.ts` | Note popup/editor for highlight, note, area |
| `annotations/text-editor.sheet.ts` | Editor for side notes and summaries (body + tags) |
| `reader/text-layer.ts` | Render pdf.js TextLayer into a div, tag spans with `data-item` |
| `reader/highlight-layer.component.ts` | Draws rects, note dots, flash, hit-test taps |
| `reader/selection.service.ts` | Tracks the current selection → `PendingSelection` |
| `reader/selection-toolbar.component.ts` | 4 colors, Note, Copy |
| `reader/area-tool.directive.ts` | Drag a rectangle on a page |
| `reader/reflow-highlights.ts` | Pure: split paragraph text into plain/highlighted runs |
| `notes/notes.page.ts` | Notes hub tab |

Modified: `reader/pdf-session.ts` (+`renderTextLayer`), `reader/page-view.component.ts`, `reader/pager.component.ts`, `reader/scroller.component.ts`, `reader/reflow-view.component.ts`, `reader/reader.page.ts`, `reader/reader.state.ts` (+flash), `reader/book-panel.sheet.ts`, `reader/outline.ts`, `app.routes.ts`, `ui/copy.ts`, `ui/icons.ts`, `ui/tokens.css`, `e2e/reader.spec.ts`, `docs/deploy-and-test.md`.

---

### Task 1: AnnotationService and copy/icons

**Files:**
- Create: `app/src/app/annotations/annotation.service.ts`, `annotation.service.spec.ts`
- Modify: `app/src/app/ui/copy.ts`, `ui/icons.ts`

**Interfaces:**
- Produces:
  ```ts
  export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
  export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
  export type NewAnnotation = Omit<Annotation, 'id' | 'updatedAt' | 'deviceId' | 'createdAt' | 'tags' | 'deleted'> & { tags?: string[] };
  @Injectable({ providedIn: 'root' }) class AnnotationService {
    forBook(bookId: ID): Signal<Annotation[] | undefined>; // live, not deleted, sorted by page (undefined page last) then createdAt
    all(): Signal<Annotation[] | undefined>;               // live, every book, not deleted
    create(input: NewAnnotation): Promise<Annotation>;
    update(id: ID, patch: Partial<Pick<Annotation, 'color' | 'body' | 'tags' | 'type' | 'text' | 'rect' | 'page' | 'scope'>>): Promise<Annotation | undefined>;
    remove(id: ID): Promise<Annotation | undefined>;       // soft-delete; returns the record as it was before
    restore(rec: Annotation): Promise<void>;               // puts it back with deleted removed
    addHighlight(bookId: ID, anchor: TextAnchor, color: HighlightColor): Promise<{ created: Annotation; mergedAway: Annotation[] }>;
    undoAddHighlight(r: { created: Annotation; mergedAway: Annotation[] }): Promise<void>;
  }
  ```
  `addHighlight` uses `anchorsOverlap` and `unionAnchor` from Task 2 — to keep this task independent, implement `addHighlight` here against those two imports and stub nothing: **Task 2 must be done first** (see Dispatch).
- `COPY.annotations` keys (exact strings): `highlight: 'Highlight'`, `note: 'Note'`, `copy: 'Copy'`, `copied: 'Copied'`, `addNote: 'Add a note'`, `notePlaceholder: 'Write a note…'`, `tags: 'Tags'`, `addTag: 'Add a tag'`, `delete: 'Delete'`, `deleted: 'Deleted'`, `edit: 'Edit'`, `save: 'Save'`, `colors: { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink' }`, `highlightSaved: 'Highlight saved'`, `area: 'Highlight an area'`, `areaHint: 'Drag over the part of the page you want to highlight.'`, `sideNote: 'Side note'`, `sideNoteOn: (p: number) => \`+ Side note on p. ${p}\``, `summary: 'Summary'`, `addSummary: '+ Summary'`, `bookSummary: 'Book summary'`, `pageRangeSummary: '+ Page-range summary'`, `fromPage: 'From page'`, `toPage: 'To page'`, `bookmark: 'Bookmark'`, `addBookmark: 'Bookmark this page'`, `removeBookmark: 'Remove bookmark'`, `bookmarkAdded: 'Bookmarked'`, `noBookmarks: 'No bookmarks yet. Tap the bookmark button while reading.'`, `onThisPage: 'On this page'`, `restOfBook: 'Rest of the book'`, `noNotes: 'No notes yet. Select text to highlight it.'`, `filters: { all: 'All', highlights: 'Highlights', notes: 'Notes', summaries: 'Summaries', areas: 'Areas' }`, `pageShort: (p: number) => \`p. ${p}\``. Add icons `highlighter`, `bookmark`, `bookmarkFilled`, `areaSelect`, `tag`, `trash`, `copy`, `pencil` to `ui/icons.ts` if missing (check first; same 24-px stroke style as the others).

- [ ] **Step 1: Write failing tests** in `annotation.service.spec.ts` (use the same TestBed + fake-indexeddb pattern as `core/repo.spec.ts`):
  - `create stamps id, createdAt, tags []` → `rec.tags` equals `[]`, `rec.id` non-empty, `rec.createdAt` is the clock time.
  - `forBook returns only that book's live annotations sorted by page then createdAt`; a soft-deleted one is absent; a `summary` (no page) sorts last.
  - `remove soft-deletes and restore brings it back` (after `remove`, `forBook` excludes it; after `restore` it is included with `deleted` undefined).
  - `addHighlight with no overlap creates one highlight with the color and quote`.
  - `addHighlight overlapping two highlights merges them`: existing A (item 1:0–1:5, body 'a', tags ['x']) and B (item 1:8–1:12, body 'b', tags ['y']) on page 3; new selection item 1:3–1:10 yellow → result: one new record whose `text.start` = 1:0 and `end` = 1:12, `body` = `'a\n\nb'`, `tags` = `['x','y']`, color 'yellow'; `mergedAway` has A and B; A and B are soft-deleted.
  - `addHighlight does not merge across pages or with notes/areas`.
  - `undoAddHighlight deletes created and restores mergedAway`.
- [ ] **Step 2: Run** `cd app && npx ng test --watch=false --include='**/annotation.service.spec.ts'` → FAIL (module missing).
- [ ] **Step 3: Implement** the service per the Interfaces. Merging only considers non-deleted `type === 'highlight'` annotations on the same book and page with a `text` anchor. Merged body = non-empty bodies of the merged-away records joined by `'\n\n'` (the new highlight has no body of its own), tags = de-duplicated union in first-seen order. `createdAt` of the merged result is the earliest `createdAt` among merged records. Add the COPY and icon entries.
- [ ] **Step 4: Run** the spec → PASS; run `npx ng build` → clean.
- [ ] **Step 5: Commit** `feat: annotation service with highlight merging`.

---

### Task 2: Anchor geometry (pure)

**Files:**
- Create: `app/src/app/annotations/anchor.ts`, `anchor.spec.ts`

**Interfaces:**
- Consumes: `TextItem` from `reader/text.ts`, `Rect`/`TextAnchor`/`Annotation` from `core/models.ts`, `PageSize` from `reader/pdf-session.ts` (type import only).
- Produces:
  ```ts
  export type Caret = { item: number; offset: number };
  export function compareCaret(a: Caret, b: Caret): number;                       // <0, 0, >0
  export function quoteOf(items: TextItem[], start: Caret, end: Caret): string;    // pieces joined with ' ', whitespace collapsed, trimmed
  export function locateQuote(items: TextItem[], quote: string, nth?: number): { start: Caret; end: Caret } | null; // nth match (0-based, default 0) of the whitespace-collapsed quote in the item stream
  export function rectsFromItems(items: TextItem[], start: Caret, end: Caret, size: PageSize): Rect[]; // one rect per touched item
  export function buildAnchor(items: TextItem[], page: number, start: Caret, end: Caret, size: PageSize): TextAnchor;
  export function anchorsOverlap(a: TextAnchor, b: TextAnchor): boolean;          // same page and a.start <= b.end && b.start <= a.end
  export function unionAnchor(a: TextAnchor, b: TextAnchor, items: TextItem[], size: PageSize): TextAnchor; // min start, max end, quote and rects rebuilt
  export function hitTest(anns: Annotation[], page: number, x: number, y: number): Annotation | null; // x,y normalized; text rects and area rect; the newest createdAt wins
  export function hasDetail(a: Annotation): boolean;                              // body non-empty or tags non-empty
  ```
  Geometry rule: an item's PDF `transform` is `[a,b,c,d,e,f]` with origin bottom-left in points: its box is x=`e`, width=`item.width`, top = `size.heightPt - (f + item.height)`, height=`item.height`. A partial range takes the fraction `offset/str.length` of the width from the item's start edge; for an item whose text is mostly Arabic (≥ 30% Arabic letters, as `text.ts` defines) the fraction is measured from the right edge. Normalize by `size.widthPt` / `size.heightPt`.

- [ ] **Step 1: Write failing tests** (`anchor.spec.ts`), items fixture: `A = { str: 'Hello world', transform: [12,0,0,12,100,700], width: 110, height: 12 }`, `B = { str: 'second line', transform: [12,0,0,12,100,680], width: 100, height: 12, hasEOL: true }`, page size `{widthPt: 600, heightPt: 800}`:
  - `quoteOf across two items` → `'world second'` for start 0:6, end 1:6.
  - `locateQuote finds the second occurrence` with nth=1 on items `['a b', 'a b']` and quote `'a b'`.
  - `locateQuote ignores whitespace differences` (`'Hello   world'` finds the same range as `'Hello world'`) and returns `null` when absent.
  - `rectsFromItems for a full item` → one rect `{x: 100/600, y: (800-(700+12))/800, w: 110/600, h: 12/800}`.
  - `rectsFromItems for half an item` (0:0–0:5 of 'Hello world') → `w` = 110*(5/11)/600.
  - `rectsFromItems measures Arabic from the right edge`: item `'مرحبا بالعالم'` (13 chars) at x=100 width 130, range 0:0–0:5 → rect `x` = (100 + 130*(1-5/13))/600.
  - `anchorsOverlap` true for touching ranges (a.end == b.start), false across pages and when disjoint.
  - `unionAnchor` spans min start to max end and rebuilds the quote.
  - `hitTest picks the newest of two overlapping highlights`, returns an area annotation for a point inside its `rect`, and returns `null` outside every rect or on another page.
  - `hasDetail` is false for `body: ''`/`tags: []` and true when either is set.
- [ ] **Step 2: Run** `npx ng test --watch=false --include='**/anchor.spec.ts'` → FAIL.
- [ ] **Step 3: Implement** all functions in `anchor.ts` (no Angular imports). `locateQuote` collapses whitespace on the concatenated item stream while keeping a map back to `{item, offset}`; reuse the idea of `normalizeWithMap` from `reader/text.ts` but WITHOUT folding or mark-stripping (exact characters). Items with empty `str` are skipped but keep their index.
- [ ] **Step 4: Run** the spec → PASS.
- [ ] **Step 5: Commit** `feat: pure anchor geometry for annotations`.

---

### Task 3: Text layer and highlight layer in page view

**Files:**
- Create: `reader/text-layer.ts`, `reader/text-layer.spec.ts`, `reader/highlight-layer.component.ts`, `reader/highlight-layer.component.spec.ts`
- Modify: `reader/pdf-session.ts`, `reader/page-view.component.ts`, `reader/pager.component.ts`, `reader/scroller.component.ts`, `reader/reader.state.ts`, fakes in existing specs that implement `PageRenderer`

**Interfaces:**
- Consumes: `Annotation`, `hitTest`, `hasDetail` (Task 2), `AnnotationService.forBook` (Task 1).
- Produces:
  - `PageRenderer` gains `renderTextLayer(page: number, container: HTMLElement, cssWidthPx: number, signal: AbortSignal): Promise<void>` — fills `container` with one `<span>` per non-empty text item, each with attribute `data-item="<index into textItems(page)>"` (the index in the filtered list `textItems` returns, counting empty-string items too, so indexes equal `TextItem[]` indexes). Implemented in `PdfSession` with pdf.js `TextLayer`; fakes return `Promise.resolve()`.
  - `PageViewComponent` gets inputs `annotations = input<Annotation[]>([])`, `flashId = input<string | null>(null)`, `interactive = input(true)` and outputs `annotationTap = output<Annotation>()`, `pageTap = output<void>()`. Template order inside `.box`: `<canvas>`, `<iqra-highlight-layer>`, `<div class="text-layer" data-page=…>`. The text layer is `position:absolute; inset:0; user-select:text; color:transparent`, with `--selection` highlight color from tokens (add `--selection: rgba(42,157,143,.28)` light / `.4` dark if absent). Render the text layer after the canvas finishes; abort it with the same controller; clear it on page change.
  - `HighlightLayerComponent` (`iqra-highlight-layer`): inputs `annotations: Annotation[]`, `flashId: string | null`; draws every text rect and area rect as an absolutely positioned div using percentages (`left/top/width/height` = rect × 100 %), color from `var(--hl-<color>)`, `mix-blend-mode: multiply` in light themes and `normal` in the `night` theme; `type === 'note'` rects are drawn as a 2 px underline in `--accent` instead of a fill; after the LAST rect of an annotation with `hasDetail` draw a 6-px teal dot. The layer has `pointer-events: none`. The flash id pulses its rects (`animation` 900 ms; none under reduced motion).
  - `ReaderState.flash = signal<string | null>(null)` and `flashAnnotation(id: string): void` (sets it, clears after 1200 ms).
  - Tap handling: `PageViewComponent` listens for `click` on the text layer; if the selection is collapsed it computes normalized (x, y) from the click position within `.box`, calls `hitTest(annotations, page, x, y)` and emits `annotationTap`; otherwise emits `pageTap` (the reader maps `pageTap` to `toggleChrome`). Pager and scroller pass the page's annotations (`annotations().filter(a => a.page === page)`) and re-emit `annotationTap`/`pageTap`; they stop emitting their own `tap` for clicks on a page view (the page view owns it).

- [ ] **Step 1: Write failing tests:**
  - `text-layer.spec.ts`: using the real pdfjs on `e2e/fixtures/sample.pdf` is not possible in Vitest, so test the pure alignment helper `alignSpans(items: {str:string}[], spans: HTMLElement[]): HTMLElement[]` exported from `text-layer.ts`: given items `['A','','B']` and spans with text `['A','B']` it tags spans `data-item` `0` and `2`; when span count ≠ non-empty item count it tags by order and never throws.
  - `highlight-layer.component.spec.ts`: renders one div per rect with percentage style (`left: 10%` for x 0.1); a `note` annotation renders `.underline` not `.fill`; an annotation with a body renders exactly one `.dot`; `flashId` adds class `flash` to that annotation's rects only.
  - `page-view.component.spec.ts` additions: clicking the text layer with a collapsed selection at the position of a highlight emits `annotationTap` with it; clicking elsewhere emits `pageTap`; with a non-collapsed selection neither emits.
- [ ] **Step 2: Run** the three specs → FAIL.
- [ ] **Step 3: Implement** the above. In `PdfSession.renderTextLayer`: get the page, `const viewport = page.getViewport({ scale: cssWidthPx / page.getViewport({scale: 1}).width })`, `new TextLayer({ textContentSource: page.streamTextContent(), container, viewport }).render()`, then `alignSpans(items, textLayer.textDivs)` using `this.textItems(page)`; call `page.cleanup()` in `finally`; reject with the abort error when `signal` aborts (call `textLayer.cancel()`). Verify in the dev build (Step 5) that spans line up with the canvas.
- [ ] **Step 4: Run** all three specs and the full unit suite → PASS; `npx ng build` clean.
- [ ] **Step 5: Manual check script** (not a unit test): `npm run e2e -- --grep "text layer"` after Task 11 covers it; for now run the dev server build with Playwright quickly (`/opt/pw-browsers/chromium-1243`) to confirm text spans exist over the canvas for `sample.pdf` and `window.getSelection().toString()` returns text after a drag. Note the result in the group report.
- [ ] **Step 6: Commit** `feat: text layer and highlight layer in page view`.

---

### Task 4: Selection, toolbar, creating highlights

**Files:**
- Create: `reader/selection.service.ts` + spec, `reader/selection-toolbar.component.ts` + spec
- Modify: `reader/reader.page.ts`, `reader/pager.component.ts`, `reader/scroller.component.ts`, `reader/page-view.component.ts`

**Interfaces:**
- Consumes: Task 1 (`AnnotationService`, `HIGHLIGHT_COLORS`), Task 2 (`buildAnchor`), Task 3 (`data-item` spans, `.text-layer[data-page]`).
- Produces:
  ```ts
  export interface PendingSelection {
    page: number; start: Caret; end: Caret; quote: string;
    rect: DOMRect;            // viewport rect of the selection, for placing the toolbar
    source: 'page' | 'reflow';
  }
  @Injectable() class SelectionService {  // provided in the reader page's providers, not root
    readonly pending: Signal<PendingSelection | null>;
    readonly active: Signal<boolean>;      // a non-collapsed selection exists inside the reader
    attach(opts: { items: (page: number) => Promise<TextItem[]> }): void; // listens to document 'selectionchange', 150 ms debounce
    clear(): void;                          // removes the browser selection and the pending value
  }
  ```
  For a selection inside `.text-layer`: start/end come from the range's `startContainer`/`endContainer` → nearest ancestor span's `data-item` and the text-node offset, ordered with `compareCaret` (swap if reversed). A selection spanning two pages or leaving the text layer is ignored (`pending` stays null). Reflow selections are handled in Task 6 (`source: 'reflow'`).
  - `SelectionToolbarComponent` (`iqra-selection-toolbar`): input `selection: PendingSelection`; outputs `color = output<HighlightColor>()`, `note = output<void>()`, `copy = output<void>()`. Four 40-px color dots (aria-labels from `COPY.annotations.colors`), a Note button, a Copy button. Positioned `position: fixed` above the selection rect (below it when there is no room above; clamped to the viewport with 8 px margins). Hidden from the accessibility tree when no selection.
  - In `ReaderPage`: on `color` → `annotations.addHighlight(bookId, buildAnchor(items, page, start, end, size), color)` then `selection.clear()` and `toast.show(COPY.annotations.highlightSaved, { undo: () => annotations.undoAddHighlight(result) })`; on `copy` → `navigator.clipboard.writeText(quote)` then `toast.show(COPY.annotations.copied)`; on `note` → create a `type: 'note'` annotation (no color) with the anchor and open the note sheet (Task 5) on it.
  - Gestures: pager/scroller/zoom directive ignore a drag or swipe that begins while `SelectionService.active()` is true, and the pager's `touch-action` over the text layer stays `pan-y` so native long-press selection works. Tapping a single word with no selection selects that word: on `click` on a text-layer span with a collapsed selection and no highlight under the point (Task 3), use `selection.modify('move','backward','word')` + `('extend','forward','word')` (fallback: `caretPositionFromPoint`/`caretRangeFromPoint` and expand to `\b` word boundaries by splitting on whitespace) then let `selectionchange` publish it.

- [ ] **Step 1: Write failing tests:**
  - `selection.service.spec.ts` (jsdom/Vitest browser env as other reader specs): build a DOM with a `.text-layer[data-page="2"]` containing spans `data-item` 0, 1 and select from span 0 offset 2 to span 1 offset 3 → after 150 ms `pending()` equals `{page:2,start:{item:0,offset:2},end:{item:1,offset:3},quote:…}`; a reversed selection yields the same ordered result; a selection across two `.text-layer`s yields `null`; `clear()` empties it.
  - `selection-toolbar.component.spec.ts`: emits `color` with `'green'` when the green dot is clicked; has four color buttons each with an aria-label; Copy button emits `copy`.
  - `reader.page.spec.ts` additions with a fake session and fake selection: choosing a color creates exactly one annotation with that color and shows a toast with an Undo action; Undo removes it.
  - `pager.component.spec.ts` addition: a horizontal swipe is ignored while `SelectionService.active()` is true.
- [ ] **Step 2: Run** the new specs → FAIL.
- [ ] **Step 3: Implement** per Interfaces. The toolbar is rendered once by `ReaderPage` (not per page).
- [ ] **Step 4: Run** specs and full unit suite → PASS; `npx ng build` clean.
- [ ] **Step 5: Commit** `feat: select text and create highlights with undo`.

---

### Task 5: Note sheet, tag input and editors

**Files:**
- Create: `annotations/tag-input.component.ts` + spec, `annotations/note-sheet.component.ts` + spec, `annotations/text-editor.sheet.ts` + spec
- Modify: `reader/reader.page.ts` (open the sheet on `annotationTap` and after a `note` creation)

**Interfaces:**
- Consumes: `AnnotationService`, `normalizeTag` (import from `books/details/book-details.sheet`), `SheetComponent` (`<f-sheet [open] [title] [tall] (closed)>`), `ToastService`.
- Produces:
  - `TagInputComponent` (`iqra-tag-input`): `tags = model<string[]>([])`, `suggestions = input<string[]>([])`. Enter/comma/blur adds `normalizeTag(value)` when non-empty and not duplicate; each chip has a ≥ 40 px remove button; up to 6 suggestions (prefix match, excluding existing) shown as chips.
  - `NoteSheetComponent` (`iqra-note-sheet`): inputs `annotation: Annotation | null` (null = closed), `tagSuggestions: string[]`; outputs `closed`, `jump = output<Annotation>()` (reserved for the Notes hub). Shows the quote (`dir="auto"`, 3-line clamp with expand), a textarea bound to `body` (saves on blur and on close, 400 ms debounced while typing via `AnnotationService.update`), `iqra-tag-input`, four color dots (only for `highlight`/`area`; choosing one updates `color`), and a Delete button that calls `remove` and shows `toast.show(COPY.annotations.deleted, { undo: () => restore(rec) })`. Opened on a new `note` annotation, the textarea is focused. An annotation with an empty body and no tags that was just created as a `note` and is closed untouched is removed (no empty notes).
  - `TextEditorSheet` (`iqra-text-editor-sheet`): inputs `annotation: Annotation | null`, `tagSuggestions`; for `side-note` and `summary`: shows a title (`COPY.annotations.sideNote` or `.summary` plus the scope label: book / chapter title / `p. a–b`), a textarea, tags, and Delete with Undo. Summary page-range editing: for `scope.kind === 'pages'` two number inputs (`fromPage`, `toPage`, clamped to 1..pageCount, `toPage >= fromPage`) updating the scope.
  - Tag suggestions = all tags used in non-deleted annotations (sorted by frequency then name), computed in the parent via `AnnotationService.all()`.

- [ ] **Step 1: Write failing tests:**
  - tag-input: typing `' Big Question '` + Enter adds `'big-question'`; duplicate and empty are ignored; remove button removes; suggestion chip click adds it.
  - note-sheet: shows the quote; typing then closing calls `update` with the body; changing color calls `update({color:'blue'})`; Delete calls `remove` and shows a toast with an Undo that calls `restore`; a new empty `note` closed untouched calls `remove`; color dots are absent for `note` annotations.
  - text-editor: for a pages-scope summary, `toPage` below `fromPage` is corrected to `fromPage`; Delete → toast + Undo works.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** specs + full unit suite + build → PASS.
- [ ] **Step 5: Commit** `feat: note sheet, tag input and text editor sheets`.

---

### Task 6: Highlights and selection in reading mode

**Files:**
- Create: `reader/reflow-highlights.ts` + spec
- Modify: `reader/reflow-view.component.ts` (+ spec), `reader/selection.service.ts`, `reader/reader.page.ts`

**Interfaces:**
- Consumes: Task 2 (`locateQuote`, `buildAnchor`, `quoteOf`), `Paragraph` from `reader/text.ts`.
- Produces:
  ```ts
  export interface Run { text: string; annotationId?: string; color?: HighlightColor; underline?: boolean; dot?: boolean }
  export function splitRuns(paragraphText: string, marks: { id: string; quote: string; color?: HighlightColor; underline: boolean; hasDetail: boolean }[]): Run[];
  ```
  `splitRuns` finds each mark's whitespace-collapsed quote inside the paragraph text (exact characters, whitespace-insensitive, first occurrence not already covered), splits the text into plain and marked runs in order, and sets `dot: true` on the last run of a mark with detail. A quote that spans two paragraphs is matched per paragraph: the part inside each paragraph is highlighted (try the longest prefix/suffix split at the paragraph boundary by matching the quote's pieces separated by one space per boundary).
  - `ReflowViewComponent` gets `annotations = input<Annotation[]>([])`, `flashId = input<string | null>(null)`, output `annotationTap`. Paragraph text renders through `splitRuns` as `<mark>` (colored background `var(--hl-<color>)`, underline for notes, trailing dot span). Clicking a mark emits `annotationTap`.
  - Reflow selection: `SelectionService` also handles a selection inside `.reflow-article`: the quote is the whitespace-collapsed selection text; the anchor is located with `locateQuote(items, quote, nth)` where `nth` = number of earlier occurrences of the same collapsed quote in the page text before the selection start (count within the same paragraph flow); if not found, `pending` stays null and a `toast` says `COPY.annotations.cantAnchor` (add: `'Couldn’t attach this selection. Try selecting a little less.'`). `source: 'reflow'`.

- [ ] **Step 1: Write failing tests:** `splitRuns`: plain text with one mark → three runs `[before, marked, after]`; two marks in order; Arabic quote with diacritics inside an Arabic paragraph is found; a quote not present yields just the plain run; a mark with detail has `dot: true` only on its last run; overlapping marks never produce overlapping runs (earlier one wins). `reflow-view.component.spec.ts`: a highlighted phrase renders a `<mark>` with the color class; clicking it emits `annotationTap`. `selection.service.spec.ts` addition: a reflow selection of text that appears twice on the page maps to the correct occurrence.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** specs + full suite + build → PASS.
- [ ] **Step 5: Commit** `feat: highlights and selection in reading mode`.

---

### Task 7: Area highlight tool

**Files:**
- Create: `reader/area-tool.directive.ts` + spec
- Modify: `reader/reader.page.ts`, `reader/page-view.component.ts`, `reader/pager.component.ts`, `reader/scroller.component.ts`

**Interfaces:**
- Produces: `AreaToolDirective` (`[iqraAreaTool]` on a page box): inputs `enabled = input(false)`, `page = input.required<number>()`; output `areaDrawn = output<{ page: number; rect: Rect }>()`. While `enabled`, pointer events on the box start a drag (`setPointerCapture`), a rubber-band `div.area-preview` follows the pointer, and on pointer-up a rect larger than 12 px in both dimensions is emitted (normalized to the box, clamped to 0..1); smaller drags are ignored. While enabled the text layer has `pointer-events: none`, and pager/scroller/zoom gestures are disabled (reuse the `SelectionService.active`-style gate: add `ReaderState.tool = signal<'none' | 'area'>('none')` and have gestures ignore input when it is not `'none'`).
  - Top bar gets an Area button (`COPY.annotations.area`, icon `areaSelect`, `aria-pressed`) visible only in page view; turning it on shows a one-line hint toast (`COPY.annotations.areaHint`, 4 s). After `areaDrawn`, show the same color/Note toolbar as for text (reuse `iqra-selection-toolbar`; the pending item is `{ kind: 'area', page, rect }`): color → `annotations.create({ bookId, type: 'area', page, rect, color })` with an Undo toast; Note → create with `color: 'yellow'` and open the note sheet. The tool turns itself off after one area, and on Escape.
  - Switching to reading mode turns the tool off and hides the button.

- [ ] **Step 1: Write failing tests:** a pointer drag of 100×60 px inside a 200×400 box emits `rect {x: 0.25, y: 0.1, w: 0.5, h: 0.15}` for a drag from (50,40) to (150,100); a 5-px drag emits nothing; a drag started outside the box is ignored; dragging beyond the box clamps to 0..1; disabled directive emits nothing. Reader page spec: pressing the Area button toggles `aria-pressed`; Escape turns it off; the button is absent in reading mode.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** specs + full suite + build → PASS.
- [ ] **Step 5: Commit** `feat: area highlight tool`.

---

### Task 8: Bookmarks, side notes, summaries

**Files:**
- Modify: `reader/reader.page.ts`, `reader/outline.ts` (+ spec), `reader/book-panel.sheet.ts` (+ spec), `ui/copy.ts`
- Create: `annotations/summary-scope.ts` + spec

**Interfaces:**
- Produces:
  - `outline.ts`: `export function nodeRange(outline: OutlineNode[], key: string, pageCount: number): { fromPage: number; toPage: number }` (per the spec comment on `OutlineNode`: from `node.page` to the page before the next node at the same or a higher level, else to `pageCount`); `export function chapterAt(outline: OutlineNode[], page: number): OutlineNode | null` (deepest node whose range contains the page; reuse the logic behind the existing `chapterTitleAt`, which now delegates to it).
  - `summary-scope.ts`: `export function scopeLabel(scope: SummaryScope): string` (`'Book'` via `COPY.annotations.bookSummary`, node title for outline, `p. a–b` for pages) and `export function findSummary(anns: Annotation[], scope: SummaryScope): Annotation | undefined` (non-deleted summary whose scope is the same kind and: book → any; outline → same `nodeKey`; pages → same `fromPage` and `toPage`).
  - Top-bar bookmark button (icon `bookmark`/`bookmarkFilled`, aria-label `addBookmark`/`removeBookmark`): toggles a `bookmark` annotation for the current page (`page` = `s.page()`); adding shows toast `bookmarkAdded`, removing shows toast `deleted` with Undo. The button reflects whether the current page has a live bookmark.
  - Book panel changes this task: Contents tab gets a "Book summary" card at the top and, on every outline row, a small `+ Summary` / `Summary` button (opens `iqra-text-editor-sheet`, creating the summary on first save of non-empty text; never create an empty summary); books with no outline show `COPY.reader.noContents` text extended by the spec line (`'This PDF has no chapters. You can still summarize a page range from Notes.'` — update the existing string). Tab bar becomes Contents · Notes · Bookmarks · Search (Tasks 9 fills Notes and Bookmarks; this task only adds the summary UI to Contents and the bookmark toggle).
  - Side notes: "+ Side note on p. N" and "+ Page-range summary" actions live in the Notes tab (Task 9); the creation helpers `AnnotationService.create` already suffice.

- [ ] **Step 1: Write failing tests:** `nodeRange` for outline `[{key:'0',page:1,children:[{key:'0.0',page:3}]},{key:'1',page:10}]` with 20 pages → node `'0'` = 1–9, `'0.0'` = 3–9 (to the page before the next node at a higher level), `'1'` = 10–20; `chapterAt` page 5 → `'0.0'`, page 12 → `'1'`, page 1 of a book with `[]` → `null`; `scopeLabel` three cases; `findSummary` matches by scope identity and ignores deleted. Reader page: bookmark button toggles, second press removes with Undo toast; Contents shows a summary card; clicking `+ Summary` opens the editor; closing it untouched creates nothing.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** specs + full suite + build → PASS.
- [ ] **Step 5: Commit** `feat: bookmarks and summaries in the reader`.

---

### Task 9: Book panel Notes and Bookmarks tabs

**Files:**
- Modify: `reader/book-panel.sheet.ts` (+ spec), `reader/reader.page.ts`, `reader/reader.state.ts`, `ui/copy.ts`

**Interfaces:**
- Produces: Notes tab = actions row (`COPY.annotations.sideNoteOn(page)` → creates a `side-note` annotation with `page` and opens the editor; `pageRangeSummary` → creates nothing until saved: opens the editor with a draft `pages` scope `{fromPage: page, toPage: page}`), filter chips (`All`, `Highlights` = type highlight, `Notes` = note + side-note, `Summaries`, `Areas`), then two groups: "On this page" and "Rest of the book" in page order (summaries sorted by `fromPage`, then book summary first). Each row: type icon, quote or body preview (`dir="auto"`, 2 lines), tags, `p. N`. Tapping a highlight/note/area row jumps to its page (history entry via `ReaderState.jumpTo`, offset = first rect's `y` minus 0.05 clamped ≥ 0) and calls `flashAnnotation(id)`; tapping a side note or summary row opens the editor; the trailing pencil on a highlight row opens the note sheet. Empty state `COPY.annotations.noNotes`. Bookmarks tab = rows sorted by page, each showing the chapter title (`chapterAt`) or nothing, tapping jumps (history), trailing trash button removes with Undo; empty state `noBookmarks`. The panel's open button shows a numeric badge: the number of live annotations on the current page excluding bookmarks (hidden when 0).
- Consumes: Tasks 1, 5, 8.

- [ ] **Step 1: Write failing tests** (extend `book-panel.sheet.spec.ts`): with annotations on pages 2 and 9 and current page 2 → "On this page" lists the page-2 item and "Rest of the book" the page-9 item; the `Summaries` chip hides highlights; tapping a highlight row emits a jump to its page (via the panel's `jump` output) and a flash request; side-note action creates one with the current page; bookmarks list shows chapter title and removes with Undo toast; badge shows `1`. Reader page spec: tapping a note row jumps and pushes a history entry (Back button enabled).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** specs + full suite + build → PASS.
- [ ] **Step 5: Commit** `feat: notes and bookmarks tabs in the book panel`.

---

### Task 10: Notes hub

**Files:**
- Create: `annotations/notes-search.ts` + spec, `notes/notes.page.ts` + spec
- Modify: `app.routes.ts`, `reader/reader.page.ts` (open at an annotation), `ui/copy.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface NotesFilter { query: string; types: Annotation['type'][]; tags: string[] }   // empty types/tags = no restriction
  export interface BookGroup { book: Book; items: Annotation[] }
  export function searchNotes(anns: Annotation[], books: Book[], f: NotesFilter): BookGroup[];
  ```
  Query = whitespace-split terms, ALL must appear (case-insensitive, using `normalizeWithMap`-style folding from `reader/text.ts` so Arabic marks/variants match) in the concatenation of quote, body, tags and book title. Bookmarks are excluded. Groups follow the library's book order (title, case-insensitive); items by page then createdAt; books with no items are omitted; annotations of deleted books are omitted.
  - `NotesPage` (`/notes`, lazy `loadComponent`): search field, type chips, tag chips (all tags used, most used first), results grouped by book (book title heading, count). Row tap: highlight/note/area → `router.navigate(['/read', bookId], { queryParams: { page, a: annotationId } })` through the existing open-book flow (the open-book sheet decides between Drive and download: reuse `OpenBookSheet` exactly as the library does when the book is not downloaded); side-note/summary → opens `iqra-text-editor-sheet` in place. Empty state when no annotations: `COPY.annotations.hubEmpty` = `'Highlights, notes and summaries from all your books will show up here.'`; no results: `COPY.annotations.hubNoResults` = `'Nothing matches. Try fewer words or clear the filters.'`. Replace the Notes route's `ComingSoonPage` (Stats stays).
  - `ReaderPage` reads query params `page` and `a` on load: after the restored position it jumps to `page` with offset 0.05 above the annotation's first rect (history entry, so Back returns), then calls `flashAnnotation(a)`; invalid values are ignored; if the annotation was deleted nothing flashes. A `?page=` open must not be overwritten by the cross-device position toast logic.

- [ ] **Step 1: Write failing tests:** `searchNotes`: query `'darwin'` matches by book title; `'big question'` matches tag `big-question` + body; type filter; tag filter; Arabic query without diacritics matches a quote with diacritics; deleted annotations and bookmarks absent; groups sorted by title. `notes.page.spec.ts`: renders groups; typing in the search narrows; tapping a highlight navigates with `page` and `a` query params; tapping a summary opens the editor. Reader page spec: opening with `?page=7&a=X` shows page 7 and sets `flash` to `X`; `?page=abc` is ignored.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** specs + full suite + build → PASS (check initial bundle stays within the existing budget).
- [ ] **Step 5: Commit** `feat: notes hub with search and open-at-annotation`.

---

### Task 11: End-to-end tests, sync check, docs

**Files:**
- Modify: `app/e2e/reader.spec.ts`, `app/src/app/sync/sync-engine.spec.ts` (add one test), `docs/deploy-and-test.md`, `README.md` status line
- Maybe modify: `app/e2e/fixtures/make-fixtures.mjs` (only if `sample.pdf` lacks selectable text; it must contain several lines of real text)

**Interfaces:** consumes everything above.

- [ ] **Step 1: Write the e2e tests** (follow the existing harness in `reader.spec.ts`; programmatic selection via `page.evaluate` that selects the text of a `.text-layer span` with a `Range` and dispatches `selectionchange`, plus one real mouse-drag test):
  - `text layer: selecting text shows the toolbar`.
  - `highlight: picking green saves, survives reload, and is drawn` (reload the page, the `iqra-highlight-layer` still has a green rect).
  - `highlight: Undo from the toast removes it`.
  - `note: tapping a highlight opens the note sheet; typing a note adds the dot and survives reload`.
  - `area: drag a rectangle, pick a color, it is drawn; Esc cancels the tool`.
  - `bookmark: toggling lists it in the Bookmarks tab and tapping it jumps`.
  - `reading mode: the saved highlight shows as a mark`.
  - `notes hub: search finds the note and tapping it opens the book at the page with the flash`.
- [ ] **Step 2: Run** `npm run e2e` → new tests FAIL only where behavior is missing; fix app bugs found (keep tests strict, no arbitrary sleeps: wait on locators).
- [ ] **Step 3: Sync test** in `sync-engine.spec.ts`: two devices (existing FakeDrive harness) each create a different annotation on the same book offline, then both sync twice → both devices have both annotations; a third edit of the same annotation on both with different `updatedAt` converges to the newer; a soft-deleted annotation stays deleted on both.
- [ ] **Step 4: Docs:** add to `docs/deploy-and-test.md` a "Highlights and notes checks" list for real devices: long-press selection and handle dragging on Android; word tap; color dots saving instantly; swipe not firing while a selection exists; pinch still works with highlights present; Arabic selection and highlight alignment (rects match text); highlights visible in sepia/night; note dot visible; area drag on touch; Notes hub search with Arabic; sync of a highlight to the other device within ~1 minute; scanned PDF has no selection but area/bookmark work. Update the README status line.
- [ ] **Step 5: Run** unit (`npx ng test --watch=false`), build (`npx ng build`), e2e twice → all green.
- [ ] **Step 6: Commit** `test: annotation e2e, sync convergence, docs`.

---

## Dispatch plan (controller notes)

Groups (one implementer + one reviewer each, in this order because later tasks import earlier ones): **A** = Tasks 2, 1 (do Task 2 before Task 1); **B** = Tasks 3, 4; **C** = Tasks 5, 6, 7; **D** = Tasks 8, 9; **E** = Tasks 10, 11; then a whole-branch review. Branch: `plan-3-annotations`. Ledger: `.superpowers/sdd/2026-11-19-iqra-plan-3-annotations/`.

## Self-review

- Spec coverage (§9.5 selecting/tap/area/merge/undo/dot, §9.6 anchors incl. reading mode, §9.9 Notes/Bookmarks tabs + badge + summaries + side notes, §9.10 hub) → Tasks 3–10. Tag action on the selection toolbar is covered by the note sheet's tag input (a selection's "Tag" lands in Note); the Arabic button is intentionally deferred. Chapter progress bars and marked checkboxes are Plan 4.
- Types: `Caret`, `buildAnchor`, `HighlightColor`, `PendingSelection`, `Run`, `NotesFilter` are each defined once and referenced consistently.
- Known risks recorded for the reviewers: alignment of pdf.js text-layer spans to `textItems` indexes (Task 3 step 5), touch selection vs swipe on a real Android device (manual check list), reading-mode quote location when a quote repeats (Task 6).
