# Iqra Plan 6: Reader and Library UX overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the owner's 18 reported issues: calmer fixed reader chrome with a right-hand toolbar and side drawer, easier actions (context menu, shortcuts, undo/redo), Arabic search/selection, back navigation, smarter sync and fewer sign-ins, library category bar, a heat-map style Stats view, hover labels, and a UI/UX polish pass.

**Architecture:** Mostly UI restructuring inside the lazy reader chunk (`reader/`), plus targeted fixes in auth/sync/routes, the Library page and the Stats page. No data-model changes except where stated (Stats colouring reads existing records). Pure logic (undo stack, heat-map buckets, category ordering, Arabic text handling, sync scheduling) is unit-tested in isolation.

**Tech Stack:** Angular 22 signals, Dexie, pdf.js 6.5, Vitest, Playwright.

**Spec:** `docs/specs/2026-11-14-iqra-design.md` §9.5, §9.7, §9.9, §9.11, §10; this plan **overrides** §9.5 "tapping the page toggles the bars" (bars are now always visible).

## Global Constraints

- Everything from earlier plans still applies (copy from the proper copy module, tokens only, `dir="auto"` on user text, 40 px targets, focus rings, reduced motion, never hard-delete synced records, Undo for destructive actions, no eager bundle growth beyond what is stated).
- **Bundle:** the initial-bundle warning budget is raised from 500 kB to **540 kB** in `app/angular.json` (this plan changes the eager Library page and adds a global tooltip); the target is still ≤ 515 kB. New reader code stays in the lazy reader chunk.
- Keyboard + pointer first (the owner reads on a Windows web view), touch must keep working. Every new action has a keyboard shortcut or a menu item and an `aria-label`.
- The fake-Drive/fake-Auth/fake-Calendar e2e harness stays e2e-only.
- Gates: `npx ng test --watch=false`, `npx ng build`, `npm run e2e -- --trace off` (run twice at the end of each group).

## Owner decisions (resolve ambiguity; do not re-ask)

- Reader chrome is **always visible**: a slim **header** (book title + current chapter › section, page indicator `p. 12 / 300` at the end) and **one vertical toolbar** fixed at the right edge, vertically centered. No bottom bar, no slider, no tap-to-hide. Page navigation = swipe/scroll, ← → / PageUp / PageDown / Space keys, and the Contents panel; the header's page indicator opens a "Go to page" input (Enter jumps, history entry).
- Toolbar buttons (top to bottom): Contents & notes (opens the side drawer), Search, Bookmark this page (toggle), Mark page read (toggle, only meaningful in marked mode but always shown; in last-page mode it is disabled with the tooltip "Switch to marked mode to mark pages"), Area highlight (toggle), Reading mode (page ⇄ reflow), Reading settings, Progress mode (popover: "Track by last page / by marked pages"), Undo, Redo, Full screen (browser Fullscreen API; header and toolbar stay visible). Back/Forward jump buttons appear in the header when history exists.
- The Contents/Notes/Bookmarks/Search panel is a **right side drawer** (desktop ≥ 900 px: docked 380 px panel that overlays the page edge with a scrim only on narrow screens; narrow screens: full-height drawer from the right, 88 vw max 420 px) — never a centered pop-up. Esc closes it. The toolbar stays visible when the drawer is open (drawer sits to the left of the toolbar).
- Hover/focus labels for every icon-only button, app-wide, via ONE global tooltip service (event delegation on `document` for `[aria-label]` elements that are buttons/links with no visible text; 350 ms delay; hidden on touch; positioned beside/below the element; also shows the keyboard shortcut when the element has `data-shortcut`). No per-component imports.
- Heat map colours: each day cell is coloured by the **category with the most reading time that day** (books with no category use the neutral accent); intensity = 4 levels by that day's pages (or time) relative to the period's max. A book in several categories counts toward the first category by `order`.

---

## File Structure

| File | Responsibility |
|---|---|
| `ui/tooltip.service.ts` | Global hover/focus labels (eager, tiny) |
| `reader/reader-toolbar.component.ts` | Right vertical toolbar |
| `reader/reader-header.component.ts` | Title, chapter › section, page indicator, go-to-page |
| `reader/drawer.component.ts` | Side drawer container (replaces the centered sheet for the panel) |
| `reader/book-panel.sheet.ts` → `book-panel.drawer.ts` | Panel content in the drawer |
| `reader/toc-tree.component.ts` | Collapsible contents tree with progress/summary/mark controls |
| `reader/context-menu.component.ts` | Right-click / long-press action menu |
| `reader/undo-stack.ts` | Pure undo/redo stack for annotation actions |
| `reader/arabic-text.ts` | Arabic search normalisation + direction helpers |
| `books/library/category-bar.component.ts` | Category chips with inline manage |
| `stats/heatmap.ts`, `stats/heatmap.component.ts` | Week/month/year buckets and rendering |

---

### Task 1: Reader chrome redesign (items 10, 5, 6, 11, 8)

**Files:** Create `ui/tooltip.service.ts`, `reader/reader-toolbar.component.ts`, `reader/reader-header.component.ts`, `reader/drawer.component.ts` (+ specs). Modify `reader/reader.page.ts`, `reader/reader.state.ts`, `reader/book-panel.sheet.ts` (rendered inside the drawer instead of `f-sheet`; rename file to `book-panel.drawer.ts` only if trivial), `app/app.ts`, `app.routes.ts` untouched, `angular.json` (budget), copy.

- [ ] Replace the top bar, bottom bar, slider and tap-to-toggle with the header + vertical toolbar from "Owner decisions". Remove `ReaderState.chrome`/`toggleChrome` usage (taps no longer hide anything); page area uses the full height between the header and the window bottom and the full width minus the toolbar width (52 px).
- [ ] Toolbar buttons as listed; each has `aria-label`, `data-shortcut`, ≥ 40 px, `aria-pressed` for toggles. Shortcuts (ignored in inputs/textareas via `isReaderKeyIgnored`): `B` bookmark, `M` mark page read, `A` area tool, `R` reading mode, `/` or `Ctrl+F` search (prevent default), `C` contents, `N` notes, `F` full screen, `Ctrl+Z` undo, `Ctrl+Shift+Z`/`Ctrl+Y` redo, `G` go to page, `?` shortcut cheat-sheet (small modal listing them), `Alt+←/→` history (already).
- [ ] Progress mode switch (item 8): toolbar popover with two options bound to `Book.progressMode` (via `Repo.update`); both data sets are kept; the Mark-read button enables/disables accordingly; toast on switch: `Now tracking by marked pages` / `by last page reached`.
- [ ] Mark page read (item 11): toolbar toggle + `M`, uses `ReadMarkService.toggle`; when marking the last unmarked page the finish prompt fires (existing logic). In marked mode a successful mark may advance nothing automatically (no auto page change).
- [ ] Global tooltip service (item 6): installed once from `app.ts`; adds a single `role="tooltip"` element, describes via `aria-describedby`; reads the label from `aria-label` (and `data-shortcut`); never shows on touch pointers; hides on scroll/click/Esc; works for the Library, Stats, Settings and reader icon buttons without touching their templates (add `aria-label` where an icon button has none — grep for `class="icon-btn"`/`class="ib"` without one).
- [ ] The book panel opens in the side drawer (`iqra-drawer`: right side, slide 220 ms (none under reduced motion), focus trap on narrow screens only, Esc closes, tab buttons inside use a vertical or top tab strip within the drawer).
- [ ] Tests: header shows title and `chapter › section` (Arabic titles `dir="auto"`); no bottom bar/slider in DOM; toolbar buttons exist with labels; each shortcut triggers its action and is ignored while typing in an input; progress-mode popover changes `Book.progressMode` and keeps marks; mark toggle disabled in last-page mode with the right tooltip text; tooltip service shows after 350 ms on hover, not on touch, hides on Esc; drawer opens/closes with Esc and does not cover the toolbar; budget changed in `angular.json`; e2e `reader.spec.ts` adjusted to the new chrome (replace tests that tapped to hide bars).
- [ ] Commit `feat: fixed reader header, right toolbar, side drawer and global tooltips`.

### Task 2: Collapsible contents, summary and mark-read redesign (items 2, 4)

**Files:** Create `reader/toc-tree.component.ts` (+ spec). Modify the panel's Contents tab, `annotations/summary-scope.ts` only if needed, copy.

- [ ] Contents tree: every node with children has a chevron toggle (`aria-expanded`, ≥ 40 px hit area, `→`/`←` keys expand/collapse, `*` expands all); **Expand all / Collapse all** buttons in the Contents header; default: top level expanded one level, the branch containing the current chapter auto-expanded and scrolled into view; expansion state remembered per book in `sessionStorage`.
- [ ] Each row, left to right: chevron · chapter title (`dir="auto"`, truncates with ellipsis, full title in tooltip) · page number · a **progress ring** (16 px, tooltip `55 % read`) that doubles as the mark control in marked mode (click toggles the whole chapter range; filled ring + check when complete) · a **summary badge**.
- [ ] Summary badge (item 4): when a summary exists → a filled note icon with the tooltip/label `Summary written` (click opens the editor); when none → a faint outlined `+` note icon that appears on row hover/focus (always visible on touch) with the label `Add summary`. No text "Summary" / "+ Summary" strings. The "Book summary" card shows `Write a summary` (empty state, dashed outline) or the first 2 lines of the text with `Edit`.
- [ ] Remove the old per-row text buttons and the "Mark read" check button style; chapters done line stays at the top (`N of M chapters done`).
- [ ] Tests: collapsing hides descendants; expand/collapse all; current chapter's branch is expanded and scrolled; keyboard arrows toggle; state persists in sessionStorage and ignores storage errors; summary badge shows filled vs outlined states correctly for chapter, section and book; no "+ Summary" text anywhere; ring click marks/unmarks the range (marked mode) and is a non-interactive progress indicator in last-page mode.
- [ ] Commit `feat: collapsible contents with clearer summary and progress controls`.

### Task 3: Context menu, undo/redo, selection toolbar placement (items 3, 7, 16)

**Files:** Create `reader/context-menu.component.ts`, `reader/undo-stack.ts` (+ specs). Modify `reader/reader.page.ts`, `reader/selection-toolbar.component.ts`, `reader/area-tool.directive.ts`, `reader/reader.state.ts`.

- [ ] **Context menu:** right-click (and touch long-press on blank page areas) opens a menu at the pointer with: Add side note on p. N · Bookmark this page / Remove bookmark · Mark page as read / Unmark · Area highlight · Add page-range summary · Go to page… · Copy page text. When there is a text selection, the menu additionally lists the four colour dots, Note, Copy (instead of the native menu; `contextmenu` is prevented only inside the page area). Keyboard: `Shift+F10`/ContextMenu key opens it at the page centre; arrow keys navigate, Enter activates, Esc closes. Menu is clamped to the viewport.
- [ ] **Undo/redo (item 7):** `UndoStack` holds reversible commands `{ label, undo(): Promise<void>, redo(): Promise<void> }` (max 100). Annotation create (highlight, area, note, side note, bookmark), delete, colour/body/tag edits and mark-read toggles push commands. Toolbar Undo/Redo buttons + `Ctrl+Z`, `Ctrl+Shift+Z`/`Ctrl+Y`; disabled when empty; toast after an undo says `Undid <label>` with a `Redo` action. The stack is per reader session (cleared when leaving the book). Existing per-action Undo toasts keep working and also use the stack so they never double-undo.
- [ ] **Stuck tools (item 7):** bookmark and area tool are real toggles: pressing the bookmark button again removes it (with undo); pressing the area tool again, pressing Esc, switching view, or right-click cancels it; the area tool auto-exits after one area and shows a visible "Area highlight on — drag over the page, Esc to cancel" chip in the header while active; after creating a bookmark/area the tool state is reset so the button never looks stuck.
- [ ] **Selection toolbar under the selection (item 16):** position below the selection end with an 8 px gap, flipped above only if it would overflow the bottom of the viewport; on touch add an extra 28 px offset so it clears the system selection handles.
- [ ] Tests: context menu items per situation (with and without selection); menu closes on Esc/click-away; `contextmenu` outside the page area is not prevented; `UndoStack` push/undo/redo/clear, redo cleared by a new push, max size; undo of a highlight merge restores the originals; bookmark toggle twice leaves no bookmark and is undoable; area tool cancel paths (Esc, second press, right-click); toolbar placed below with flip; e2e: right-click → add side note works; Ctrl+Z removes a just-created highlight and Ctrl+Shift+Z brings it back.
- [ ] Commit `feat: reader context menu, undo/redo, tool toggles, selection toolbar below text`.

### Task 4: Arabic search and selection (item 9)

**Files:** Create `reader/arabic-text.ts` (+ spec), an Arabic fixture `e2e/fixtures/arabic.pdf` (generate in `make-fixtures.mjs` with an embedded Arabic font from `node_modules/@fontsource/aref-ruqaa` or Amiri converted as needed; if embedding is impractical, use pdf.js's own test approach: draw shaped text with a standard font that has Arabic glyphs). Modify `reader/search.service.ts`, `reader/text.ts`, `reader/page-view.component.ts`/`text-layer.ts`, `reader/reflow-view.component.ts`.

- [ ] **Diagnose first with the fixture** (write findings in the report): (a) why a search for an Arabic word finds nothing — check the extracted item order/direction (pdf.js may return Arabic items in visual order or with presentation-form glyphs U+FB50–FEFF), whitespace between items, and `normalizeWithMap`; (b) why selecting Arabic runs left-to-right — pdf.js text-layer spans need `dir="rtl"` (from `TextItem.dir`) and the layer container for an RTL page must not force `direction: ltr`.
- [ ] Fix search: normalise presentation forms to base letters (NFKC), strip tashkeel/tatweel, fold alef/ya/ta-marbuta variants (already), unify Arabic-Indic and Persian digits with Western digits for matching (displayed text unchanged), match across item boundaries and across line breaks with a single space, and treat the query's direction independently of the extraction order (if the page text is in visual order, also try the reversed-word-order text as a fallback and map hits back). Snippets show the original text.
- [ ] Fix selection: spans get `dir` from the item's direction; the text layer container uses `unicode-bidi: plaintext`; verify a drag from right to left over an Arabic line selects the expected words in reading order and that the anchor offsets (`start`/`end`) stay ordered (Task from Plan 3 `compareCaret`); highlights/rects for RTL items already measure from the right edge — verify with the fixture.
- [ ] Tests: arabic-text unit tests (presentation forms, diacritics, digit unification, reversed-order fallback); search finds a word with and without diacritics in the fixture; e2e: search for an Arabic word returns hits and jumps; programmatic selection across an Arabic line yields the right quote and a highlight whose rects overlap the line; selection spans carry `dir="rtl"`.
- [ ] Commit `fix: Arabic search and right-to-left text selection`.

### Task 5: Back navigation, smart sync, fewer sign-ins, Calendar error (items 1, 13, 17, 12)

**Files:** Modify `reader/reader.page.ts` (+ routes if needed), `sync/sync-engine.ts`, `auth/auth.service.ts`, `settings/reminders.section.ts`, `reminders/*`, `settings/settings-copy.ts`.

- [ ] **Back (item 1):** reproduce with an e2e (Library → open book → browser Back must return to Library; also Library → book → Settings → Back). Find why it fails (candidates: `replaceUrl` use, a router guard redirect, history entries added by the query-param clearing, `routerLink="/library"` replacing instead of going back, or a `popstate` handler swallowing Back). Fix so: the header's back arrow goes to the previous app page (`Location.back()` when history exists, else `/library`) and flushes the reading position first; browser Back does the same; keep jump history (Alt+←) separate.
- [ ] **Smart sync (item 13):** a `SyncScheduler` policy on top of `SyncEngine`: sync on app start; on `visibilitychange` visible if the last sync is older than 60 s; on `online`; **debounced 5 s after any local change** (existing); **immediately when leaving the reader** (after flushing position and session) and when navigating to Library if the last sync is older than 60 s; right after a settings change (the 5 s debounce covers it — add a test); the 2-minute poll runs only while the tab is visible and signed in, backing off to 5 minutes after 3 idle (no-change) passes; never more than one sync in flight; never while offline/paused. No sync-on-keystroke churn. Unit tests with a fake clock for each trigger and the back-off.
- [ ] **Fewer sign-ins (item 17):** investigate and fix why the user must click Sync/reconnect repeatedly: Google token lifetime is 1 h; (1) request a fresh token silently ~5 min **before** expiry while the app is visible (`prompt: ''`/hint with the known account) and on `visibilitychange`; (2) a silent failure must NOT flip the state to `expired` if the token is still valid or the failure was transient/offline — only flip on a real auth rejection (401) or after silent renewal failed AND the token is actually expired; (3) when a popup is truly needed, show ONE persistent, non-modal banner "Reconnect to keep syncing" (a single click), never repeated toasts, and after a successful reconnect retry pending sync automatically; (4) keep working offline without prompts; (5) remember the account hint in localStorage. Document in `docs/setup-google.md`/deploy checks what to verify (a 2-hour session).
- [ ] **Calendar error (item 12):** map Google's error reasons precisely and show them: `accessNotConfigured`/`SERVICE_DISABLED` → "Google Calendar API isn't enabled for this project. Enable it in Google Cloud Console (APIs & Services → Library → Google Calendar API)."; `insufficientPermissions`/scope rejected → "Google didn't grant calendar access. Check the consent screen scopes."; network `TypeError`/timeouts → "Couldn't reach Google. Check your connection and try again."; anything else → "Google Calendar returned an error (<status> <reason>)." Never use the generic "Couldn't reach Google Calendar" for API errors. Include the reason in the status area and `console.warn`. Add the Calendar API enablement as step 1 in `docs/setup-google.md`.
- [ ] Tests: e2e back-navigation cases above; scheduler unit tests; auth renewal tests (renew before expiry; transient failure keeps `signed-in`; real 401 → expired + one banner; no repeated toasts); Calendar error mapping tests with the fake adapter returning `accessNotConfigured` (403 body) etc.
- [ ] Commit `fix: back navigation, smarter sync timing, silent token renewal, precise Calendar errors`.

### Task 6: Library category bar (item 14)

**Files:** Create `books/library/category-bar.component.ts` (+ spec). Modify `pages/library/library.page.ts`, `books/library/library-query.ts` (add an `uncategorized` category filter value), the filter sheet (remove its category section), settings categories section stays as an alternative.

- [ ] A horizontally scrollable chip row under the search/tabs: **All · Uncategorized · <each category in `order`>** plus a `+` chip. A single chip selects; `Ctrl/Cmd-click` or a long-press toggles multi-select (OR across categories, as today's filter does). Counts on chips (`Fiqh 12`). Selected chip state is reflected in `LibraryState` and in the existing active-filter chips so nothing is hidden.
- [ ] Inline management in the main UI: right-click / long-press / the chip's `⋯` on hover opens a small menu: **Rename** (inline edit in place, Enter/Esc), **Delete** (Undo toast, books keep their other categories), **Move left / right** (or drag); the `+` chip opens an inline text field to add a category (Enter creates, Esc cancels). Reuse `settings/category-order.ts` helpers and the same persistence/Undo logic as the Settings section (extract shared functions into `books/category.service.ts` used by both; behaviour stays identical).
- [ ] Remove the category list from the Filter popup (it keeps rating, tags, downloaded-only).
- [ ] Tests: selecting All/Uncategorized/one/many categories filters correctly (uncategorized = no live category); counts; rename/delete/add/move through the chips including Undo; settings section still works and shares the service; keyboard access (chips are a roving-tabindex toolbar); no horizontal page scroll at 320 px.
- [ ] Commit `feat: category bar with inline management in the library`.

### Task 7: Stats heat map (item 15)

**Files:** Create `stats/heatmap.ts` (+ spec), `stats/heatmap.component.ts` (+ spec). Modify `stats/stats.page.ts`, `stats/aggregate.ts` (if a per-day-per-book breakdown is needed), `stats/stats-copy.ts`.

- [ ] Period switch **Week · Month · Year** and **‹ ›** navigation (previous/next period, `Today` button; cannot go past the current period): Week = the current layout (day-by-day bars with the totals/goals) keeping the existing week header; Month = a GitHub-style grid of day blocks (7 rows × ~5 columns, weeks in columns, first row = `weekStartsOn`), with month/day labels; Year = 52–53 week columns of day blocks (GitHub style) with month labels along the top. Blocks have 5 states: none + 4 intensities.
- [ ] Colour by category (owner decision above): `heatmapDays(sessions, books, categories, range, measure): { day, value, categoryId: ID | null, bookId?: ID }[]`; block hue = that category's colour (derive a stable colour per category from a fixed palette of 8 accessible hues in `tokens.css` by `order % 8`; neutral accent for uncategorized) with intensity levels by value relative to the period's max; legend lists categories with their colours (click a legend item to filter) and the intensity scale.
- [ ] Filters: category dropdown/chips (All, each category, Uncategorized) and a book picker (searchable list; Arabic titles `dir="auto"`); the heat map, totals, goals and chart all respect the filter; measure switch Pages/Time.
- [ ] Block interaction: hover/focus tooltip `Sat 14 Nov · 23 pages · 41 min · Fiqh`; click selects the day and lists the books read that day below the grid (title, pages, time); keyboard arrow navigation across blocks (roving tabindex); each block has an `aria-label` with the same text.
- [ ] Tests: bucketing for week/month/year ranges around DST and year boundaries; first column aligned to `weekStartsOn`; period navigation bounds; category with most time wins the day colour; intensity levels (0 / 1–25 / 26–50 / 51–75 / 76–100 % of max, boundaries exact); filters by category and book change totals and blocks; empty period shows an empty-state, no `NaN`; component renders 52–53 columns for a year; legend filter toggles.
- [ ] Commit `feat: week, month and year reading heat map with category colours and filters`.

### Task 8: UI/UX review and polish (item 18)

**Files:** whatever the review finds; budget-conscious.

- [ ] Run the `design:design-critique` skill ONCE over the Library, reader (header/toolbar/drawer/context menu), Stats and Settings using Playwright screenshots at 1280×800 and 390×844 in light and dark (save under `.superpowers/ui-shots/plan6/`), plus `design:accessibility-review` limited to contrast, focus order, target sizes and labels. Produce a prioritised list (P1/P2/P3) in `.superpowers/sdd/2026-11-22-iqra-plan-6-ux/ux-review.md`.
- [ ] Implement every P1 and the cheap P2s (spacing/typography consistency, empty states, hover/pressed states, focus rings, contrast failures, consistent icon sizes, drawer/toolbar polish, Settings layout on desktop width, Library header density); list the rest as deferred. Keep the change surface small and covered by existing tests; add tests only for behaviour changes.
- [ ] Update `docs/deploy-and-test.md` with a "Plan 6 checks" section (reader chrome, shortcuts, context menu, undo/redo, Arabic, back button, 2-hour session without re-login, calendar message, category bar, heat map).
- [ ] Commit(s) `chore: UI polish from design review`, `docs: plan 6 checks`.

---

## Review Focus

1. Keyboard shortcuts must never fire while typing in note/search/tag inputs or the page-range fields, and must not break browser shortcuts (`Ctrl+F` only intercepted inside the reader).
2. Undo/redo never loses user text and never resurrects deleted-then-sync'd records incorrectly (a remote tombstone newer than the undo must not be silently overwritten without the user pressing undo).
3. Arabic: mixed Arabic/Latin lines, diacritics, digits, and selection direction on RTL pages in both views.
4. Sign-in/sync: no popup is ever opened without a user gesture; no loop of silent-renewal failures; offline use never shows reconnect banners.
5. Layout at 320 px and 1920 px: toolbar/drawer/header never overlap content, no horizontal scroll, long Arabic titles truncate.

## Dispatch plan (controller notes)

Branch `plan-6-ux`. Ledger `.superpowers/sdd/2026-11-22-iqra-plan-6-ux/`. Groups: **A** = Tasks 1, 2 (reader shell; reviewed); **B** = Tasks 3, 4, 5; **C** = Tasks 6, 7; **D** = Task 8. Sonnet throughout; review after A and B (one concise review each), final whole-branch review (sonnet) after D.
