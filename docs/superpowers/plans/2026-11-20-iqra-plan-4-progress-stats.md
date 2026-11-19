# Iqra Plan 4: Reading time, progress, goals and stats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track reading sessions and pages read automatically, show chapter/book progress and a "Mark read" control, show per-book stats in book details, and add the Stats tab with weekly goals.

**Architecture:** Pure modules do all the math (progress, week ranges, per-day aggregation, goal progress) and are unit-tested without Angular. A pure `SessionTracker` state machine turns reader activity into sessions and counted pages; a thin `SessionService` persists `ReadingSession` records. `ReadMarkService` owns `ReadMark` records. UI reads Dexie via `Repo.live`. All records (`sessions`, `readMarks`, `goals`) already sync through `shards.ts`; no sync change.

**Tech Stack:** Angular 22 signals, Dexie via `Repo`, Vitest, Playwright. Charts are plain inline SVG/CSS (no chart library).

**Spec:** `docs/specs/2026-11-14-iqra-design.md` — §7 (ReadingSession, ReadMark, Goal, Settings), §9.2, §9.3, §9.8 (Stats tab), §9.11, §10. Code from Plans 1–3 is in `app/src/app/`.

## Global Constraints

- Copy only from `ui/copy.ts`; colors/spacing only from `ui/tokens.css`; user text `dir="auto"`; touch targets ≥ 40 px; visible focus; reduced motion respected; never hard-delete synced records (use `Repo.softDelete`); every deletion has an Undo toast.
- Reading time (spec §9.2): a session starts when a book becomes visible; activity = page turn, scroll, tap, zoom, selection; **after 2 minutes without activity the clock pauses** and the next activity resumes it; the session **ends** when the reader closes, the app goes to the background (`visibilitychange` hidden), or 30 minutes pass idle. A page counts as read when it was the current page for **≥ 5 seconds of active time**; in scroll mode the current page is the one covering most of the screen. The same page counts **at most once per day** in stats. Average time per page = total active time ÷ total pages read.
- **Started:** first day the book has ≥ 3 pages read → `Book.startedAt` = that day's start; status `to-read` → `reading`. **Finished:** reaching the last page in last-page mode (or all pages marked in marked mode) shows a toast "Mark as finished?" with action; `finishedAt` set when status becomes `finished`.
- Progress (§9.3): last-page mode = `lastPageReached / pageCount`; marked mode = marked pages ÷ `pageCount`. Chapter range from `nodeRange` (`reader/outline.ts`). Last-page chapter progress = share of its range up to `lastPageReached`, done when `lastPageReached ≥ toPage`; marked mode = share of its pages marked. "N of M chapters done" counts top-level outline nodes. Marking a chapter/section marks every page in its range; unmarking clears them. Switching modes keeps both data sets.
- Weeks start on `Settings.weekStartsOn` (default 6 = Saturday). Days are local-time days. A book in several categories counts toward every category goal. No daily streaks, no 25/50/75 % milestones.
- Gates stay green: `npx ng test --watch=false`, `npx ng build` (initial bundle ≤ 500 kB; currently 499.95 kB — all new screens are lazy-loaded; do not grow the main bundle), `npm run e2e -- --trace off`.

## Review Focus

1. Clocks and time zones: a session crossing local midnight, DST change days, and a device clock moving backwards never produce negative time, NaN, or a page counted twice per day.
2. A killed tab or crashed browser mid-session still keeps the time read so far (periodic checkpoint), and two devices' sessions never overwrite each other.
3. Books with 0 or 1 pages, no outline, or unsorted outlines: no division by zero, no `NaN%`, progress capped at 100 %.
4. Empty states: new user with no sessions/goals sees helpful empty text, not blank charts or `NaN`.
5. Deleting a book or category removes it from goals and stats without errors; stats never count deleted records.

---

## File Structure

| File | Responsibility |
|---|---|
| `progress/progress.ts` | Pure book/chapter progress |
| `stats/week.ts` | Pure week/day ranges, local-day keys |
| `stats/aggregate.ts` | Pure per-day/book/week aggregation, goal progress |
| `reader/session-tracker.ts` | Pure session state machine |
| `reader/session.service.ts` | Persists sessions, updates `startedAt`/status, finish prompt data |
| `progress/read-mark.service.ts` | ReadMark CRUD, mark/unmark ranges |
| `stats/chart.component.ts` | Bar chart (pages/time) |
| `books/details/book-stats.component.ts` | Details sheet Stats tab |
| `reader/notes-tab.component.ts`, `reader/bookmarks-tab.component.ts` | Extracted from `book-panel.sheet.ts` |
| `stats/stats.page.ts`, `stats/goal-editor.sheet.ts`, `stats/goal.service.ts` | Stats tab |

---

### Task 1: Pure progress, week and aggregation modules

**Files:** Create `progress/progress.ts`, `stats/week.ts`, `stats/aggregate.ts` and a `.spec.ts` for each.

**Interfaces:**
- Consumes: `Book`, `OutlineNode`, `ReadMark`, `ReadingSession`, `Goal`, `Category` from `core/models.ts`; `nodeRange` from `reader/outline.ts`.
- Produces:
  ```ts
  // progress/progress.ts
  export function bookProgress(b: Pick<Book,'progressMode'|'lastPageReached'|'pageCount'>, markedPages: number): number; // 0..1, 0 when pageCount<=0
  export function chapterProgress(b: Book, node: OutlineNode, marked: ReadonlySet<number>): { fraction: number; done: boolean };
  export function chaptersDone(b: Book, marked: ReadonlySet<number>): { done: number; total: number }; // top-level nodes
  // stats/week.ts
  export function dayKey(ms: number): string;                       // local 'YYYY-MM-DD'
  export function weekStart(ms: number, weekStartsOn: 0|1|6): number; // local midnight ms of the week's first day
  export function weekRange(ms: number, weekStartsOn: 0|1|6): { from: number; to: number; days: string[] }; // to = exclusive next week start; 7 day keys
  export function formatRange(from: number, to: number, locale?: string): string; // e.g. "Nov 14 – 20"
  // stats/aggregate.ts
  export interface DayStat { day: string; pages: number; ms: number }
  export function dayStats(sessions: ReadingSession[], range?: { from: number; to: number }): DayStat[]; // sorted, only days with data; a (bookId,page) counts once per day; session time assigned to the day it started
  export function totals(sessions: ReadingSession[]): { ms: number; pages: number; sessions: number; days: number; avgMsPerPage: number }; // pages = unique (book,page,day)
  export function perBook(sessions: ReadingSession[]): Map<ID, { ms: number; pages: number }>;
  export interface GoalProgress { goal: Goal; value: number; fraction: number } // value in minutes or pages
  export function goalProgress(goal: Goal, sessions: ReadingSession[], books: Book[], range: { from: number; to: number }): GoalProgress; // categoryId null = all books; a book in many categories counts for each category goal; fraction capped at 1
  ```
- [ ] **Step 1: Write failing tests** (exact values):
  - `bookProgress`: last-page 30/120 → 0.25; marked mode with 60 marked of 120 → 0.5; `pageCount 0` → 0; `lastPageReached 150, pageCount 120` → 1.
  - `chapterProgress`: node range 1–9, last-page `lastPageReached 5` → `{fraction: 5/9, done:false}`; `lastPageReached 9` → done; marked set {1,2,3} → fraction 1/3.
  - `chaptersDone` for outline top-level nodes at pages 1, 10, 20 of a 30-page book with `lastPageReached 12` → `{done: 1, total: 3}`; no outline → `{done:0,total:0}`.
  - `weekStart` with Saturday start (6): a Wednesday 2026-11-18 12:00 local → Saturday 2026-11-14 00:00 local; with Monday (1) → 2026-11-16; `weekRange(...).days` length 7 and consecutive; DST-change week still gives 7 distinct local day keys.
  - `dayStats`/`totals`: two sessions the same day both reading page 3 of book A count page 3 once (pages = 1) but add time; page 3 on the next day counts again; `avgMsPerPage` = total ms ÷ pages, 0 when no pages; `days` counts distinct days; session crossing midnight is assigned to its start day; sessions with `activeMs < 0` or non-finite are ignored.
  - `goalProgress`: pages goal target 20 with 10 pages in range → fraction 0.5; time goal in minutes (target 60; 45 min → 0.75; 90 min → fraction 1 and `value` 90); category goal counts books whose `categoryIds` include it, and a book in two categories counts toward both goals; deleted books and sessions of unknown books are excluded.
- [ ] **Step 2: Run** `cd app && npx ng test --watch=false --include='**/progress.spec.ts' --include='**/week.spec.ts' --include='**/aggregate.spec.ts'` → FAIL.
- [ ] **Step 3: Implement** the three modules (no Angular imports; local-time math through `Date`, never fixed 86 400 000 ms days).
- [ ] **Step 4: Run** the specs → PASS. **Step 5: Commit** `feat: pure progress, week and stats aggregation`.

---

### Task 2: Session tracking, read marks and reader integration

**Files:** Create `reader/session-tracker.ts` + spec, `reader/session.service.ts` + spec, `progress/read-mark.service.ts` + spec. Modify `reader/reader.page.ts`, `reader/reader.state.ts`, `ui/copy.ts`, `ui/icons.ts` (check for `check` first).

**Interfaces:**
- Consumes: Task 1 (`bookProgress`, `chaptersDone`, `dayKey`), `Repo`, `CLOCK`, `ToastService`, `nodeRange`.
- Produces:
  ```ts
  // session-tracker.ts (pure; time is passed in)
  export const IDLE_PAUSE_MS = 120_000, IDLE_END_MS = 1_800_000, PAGE_COUNT_MS = 5_000;
  export interface SessionSnapshot { startedAt: number; endedAt: number; activeMs: number; pagesRead: number[] }
  export class SessionTracker {
    constructor(now: number, page: number);
    activity(now: number): void;                 // any user activity; resumes if paused
    pageChanged(now: number, page: number): void;
    tick(now: number): { ended: boolean };       // advances clocks; ended=true after 30 min idle
    snapshot(now: number): SessionSnapshot;      // activeMs and unique pagesRead so far
    end(now: number): SessionSnapshot;
  }
  // session.service.ts
  @Injectable({ providedIn: 'root' }) class SessionService {
    start(book: Book, page: number): ReaderSessionHandle;
  }
  interface ReaderSessionHandle { activity(): void; pageChanged(page: number): void; end(): Promise<void>; }
  // read-mark.service.ts
  @Injectable({ providedIn: 'root' }) class ReadMarkService {
    marked(bookId: ID): Signal<ReadonlySet<number> | undefined>;   // live
    toggle(bookId: ID, page: number): Promise<void>;
    setRange(bookId: ID, fromPage: number, toPage: number, read: boolean): Promise<void>; // one transaction; marks/clears every page in range
  }
  ```
  Rules: the active clock runs only while the last activity was < 2 min ago (time since the last activity beyond 2 min is NOT counted; the clock resumes on the next activity); a page counts when its accumulated current-page active time reaches 5 s; time never decreases if `now` goes backwards (clamp deltas at 0). `SessionService.start` writes one `ReadingSession` (id = new uuid) immediately-lazily: first write when `activeMs ≥ 1 s` or on end, then **re-writes the same record every 30 s and on `visibilitychange: hidden`/`pagehide`** (checkpoint), final write on `end()`; sessions with 0 active ms and no pages are not written. When a session's counted pages make the book total ≥ 3 distinct pages read (sum over its sessions, per spec "first day with ≥ 3 pages read") and `startedAt` is unset, set `Book.startedAt` to that day's local midnight and `status` `to-read` → `reading`. `ReadMarkService` ids are `${bookId}:${page}`; `toggle` writes `{read: !current}` (never deletes).
  - Reader integration: `ReaderPage` starts a handle when the book is ready and visible, calls `activity()` on tap, scroll, zoom, selection, page turn (`pageChanged`), ends it on destroy/leave. Bottom bar gets a **Mark read** toggle (aria-pressed; `COPY.progress.markRead: 'Mark read'`, `markedRead: 'Marked as read'`) shown only when `book.progressMode === 'marked'`. **Finish prompt:** when `progressMode === 'last-page'` and the page becomes `pageCount` for the first time (`lastPageReached` was `< pageCount` before), or in marked mode when the last unmarked page is marked, and `status !== 'finished'`, show `toast.show(COPY.progress.finishPrompt, { actionLabel: COPY.progress.markFinished, undo: () => setFinished })` (`finishPrompt: 'You reached the end. Mark as finished?'`, `markFinished: 'Mark finished'`); the action sets `status 'finished'` and `finishedAt = now`. The toast duration is 8 s.
- [ ] **Step 1: Write failing tests:**
  - tracker: 10 s of activity on page 1 then a page change counts page 1 (≥ 5 s) but a page held 4 s does not; 3 min with no activity adds only 2 min of `activeMs`; activity after the pause resumes counting; 31 min idle → `tick().ended`; `now` moving backwards adds 0; revisiting a page does not duplicate it in `pagesRead`.
  - session service (fake clock/Repo like other specs): checkpoint rewrites the same record id (one record in the table after three checkpoints); a session with no activity writes nothing; reaching 3 pages sets `startedAt` and status `reading` once; end writes the final snapshot.
  - read marks: `toggle` twice → read false and the record still exists; `setRange(b, 3, 5, true)` marks 3–5 and `setRange(..., false)` clears them in one transaction.
  - reader page spec: Mark read button visible only in marked mode and toggles; reaching the last page in last-page mode shows the finish toast once with action; the action sets status/finishedAt; navigating to the last page again does not show it twice.
- [ ] **Step 2: Run** the specs → FAIL. **Step 3: Implement** per Interfaces. **Step 4: Run** specs + full unit + `npx ng build` → PASS (initial bundle must not grow: all session code is reachable only from the lazy reader chunk except `ReadMarkService`, which the library already needs — keep it small).
- [ ] **Step 5: Commit** `feat: reading sessions, read marks and finish prompt`.

---

### Task 3: Contents progress and book-panel split

**Files:** Create `reader/notes-tab.component.ts`, `reader/bookmarks-tab.component.ts` (+ specs). Modify `reader/book-panel.sheet.ts`, `reader/reader.page.ts`, `ui/copy.ts`.

**Interfaces:** Consumes Tasks 1–2. Produces:
- `BookPanelSheetComponent` becomes the shell (tabs + Contents + Search); the Notes and Bookmarks tabs move **unchanged in behavior** into `iqra-notes-tab` and `iqra-bookmarks-tab` with the same inputs/outputs they use today (read the current panel and keep its existing unit tests passing, moving them to the new specs where they belong). Do this split first, as its own commit.
- Contents tab: for every outline row a thin progress bar (`chapterProgress`) with `aria-label` `COPY.progress.chapterPct(n)` (`n%`), a header line `COPY.progress.chaptersDone(done, total)` = `'${done} of ${total} chapters done'` (hidden when there is no outline), and in `progressMode === 'marked'` a ≥ 40 px check button per row that calls `ReadMarkService.setRange(bookId, from, to, !allMarked)` using `nodeRange`. A row whose range is fully read shows the check as pressed.
- [ ] **Step 1: Split commit:** move code, run the full unit suite → all existing tests still PASS (no new behavior). Commit `refactor: split book panel notes and bookmarks tabs`.
- [ ] **Step 2: Write failing tests:** chapter with 5 of 9 pages reached shows a bar at `55.6 %` (`style.width`); a book without outline hides the "chapters done" line; in marked mode the check button marks the chapter range, pressing again clears it; progress bars never exceed 100 % and show 0 for a 1-page book.
- [ ] **Step 3: Implement**; **Step 4:** unit + build green (bundle unchanged ±0.1 kB; the panel is in the lazy reader chunk). **Step 5: Commit** `feat: chapter progress in contents`.

---

### Task 4: Book details Stats tab

**Files:** Create `stats/chart.component.ts` + spec, `books/details/book-stats.component.ts` + spec. Modify `books/details/book-details.sheet.ts` (replace the `statsSoon` placeholder), `notes/notes.page.ts` (accept `?book=<id>&type=<type>` query params that preset the filter), `ui/copy.ts`.

**Interfaces:**
- `ChartComponent` (`iqra-bar-chart`): `bars = input<{ label: string; value: number; tooltip: string }[]>()`, `unit = input<'pages'|'time'>('pages')`; inline SVG, bars scale to the max, each bar ≥ 40 px wide-tap-target area with `<title>`; empty → `COPY.stats.noData`. Pure helper `groupWeekly(days: DayStat[], threshold = 60): DayStat-like bars` exported for tests: more than 60 days of history → weekly bars (week by `Settings.weekStartsOn`).
- `BookStatsComponent` (`iqra-book-stats`, input `book: Book`): **Timeline** (Added · Started · Finished with dates, `COPY.stats.notYet` = `'Not yet'`), **Reading chart** (Pages/Time switch, from `addedAt` to today, daily bars; weekly when > 60 days), **Totals** (time spent `1 h 05 min`, pages read, sessions, days read, average time per page `m:ss`), **Notes** counts (highlights, notes, side notes, summaries, bookmarks) as links `routerLink="/notes" [queryParams]="{ book: id, type }"`, **Rating and review** (read-only), **Chapter progress** (outline with bars, same helper as Task 3). Data from `AnnotationService.forBook`, sessions by `bookId` via `Repo.live`.
- Formatting helpers in `stats/format.ts` (+ spec): `formatDuration(ms): string` → `'0 min'`, `'45 min'`, `'1 h 05 min'`; `formatAvg(ms): string` → `'m:ss'` (`'0:00'` when no pages).
- [ ] **Step 1: Write failing tests:** `formatDuration(3_900_000) === '1 h 05 min'`, `formatDuration(0) === '0 min'`, `formatAvg(75_000) === '1:15'`; `groupWeekly` gives 9 weekly bars for 62 consecutive days and passes 60 days through daily; chart renders one rect per bar and `noData` when empty; stats component shows `Not yet` for a book with no `startedAt`; totals match `totals(sessions)`; the Notes counts exclude deleted annotations and link with the right query params; notes page preset: opening `/notes?book=X&type=highlight` shows only that book's highlights; a book with no sessions shows the empty text and no `NaN`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS; unit + build green. **Step 5: Commit** `feat: book stats tab`.

---

### Task 5: Stats tab with weekly goals

**Files:** Create `stats/goal.service.ts` + spec, `stats/goal-editor.sheet.ts` + spec, `stats/stats.page.ts` + spec. Modify `app.routes.ts` (lazy `loadComponent`, replaces the Stats `ComingSoonPage`), `ui/copy.ts`.

**Interfaces:**
- `GoalService`: `goals(): Signal<Goal[] | undefined>` (live, not deleted), `create(g: { categoryId: ID | null; measure: 'time'|'pages'; target: number }): Promise<Goal>`, `update(id, patch)`, `remove(id): Promise<Goal | undefined>`, `restore(goal)`. Target is a positive integer (minutes or pages per week), clamped 1–100 000.
- `StatsPage` (`/stats`): **Week header** `This week · Nov 14 – 20` (via `weekRange`+`formatRange`); **Totals** pages and time each with `+12 vs last week` / `−3 vs last week` / `Same as last week` (last week from `weekRange(now - 7 days)`); **Weekly goals**: list with progress bars (`goalProgress`; label like `Reading · 3 h of 5 h` / `Pages · 40 of 100`; category name or `All books`; a goal whose category was deleted shows `All books` fallback label `COPY.stats.categoryGone` and is excluded from calculations) and an `Add goal` button; tapping a goal opens the editor; **Day-by-day chart** for the week (Pages/Time switch, 7 bars labelled with weekday letters in the user's locale); **Books in progress**: books with status `reading` showing `p. N of M · P% · time spent`; tapping opens that book's details sheet on the Stats tab (use the same open mechanism the library uses; `BookDetailsService` — read it).
- `GoalEditorSheet`: choose books (`All books` + each non-deleted category), measure (`Time spent`/`Pages read`), target number input (minutes shown as hours+minutes helper text), Save, Delete with Undo toast. Empty state with no goals: `COPY.stats.noGoals` = `'Set a weekly goal to see your progress here.'`; no reading yet this week: `COPY.stats.noReading` = `'Nothing read this week yet.'`.
- [ ] **Step 1: Write failing tests:** goal service CRUD (soft delete, restore, target clamped); stats page: with sessions in this and last week the totals show the right deltas (`+12 vs last week`), a goal with 10 of 20 pages renders a 50 % bar, deleting a category's goal row shows Undo; a goal pointing at a deleted category falls back to the label; empty states; week starting day follows `Settings.weekStartsOn` (Saturday default: header range starts Saturday); tapping a book in progress opens the details sheet on the Stats tab; the goal editor validates target > 0 and saves.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS; unit + build green (check the initial bundle is unchanged: the page is lazy). **Step 5: Commit** `feat: stats tab with weekly goals`.

---

### Task 6: End-to-end, sync check, docs

**Files:** Modify `app/e2e/reader.spec.ts` (or add `app/e2e/stats.spec.ts`), `app/src/app/sync/sync-engine.spec.ts` (one test), `docs/deploy-and-test.md`, `README.md` status.

- [ ] **Step 1: e2e tests** (use the existing harness and fixtures; to avoid waiting real minutes, expose a test hook only if one already exists — otherwise drive the clock with Playwright `page.clock`):
  - `session: reading a page for 6 s writes a ReadingSession and counts the page` (read the `sessions` table through `page.evaluate` on IndexedDB).
  - `marked mode: Mark read toggles and the library progress changes`.
  - `finish prompt: reaching the last page offers Mark finished and the action sets finished`.
  - `contents: shows chapter bars and 'N of M chapters done'` using `outline.pdf`.
  - `book stats tab shows totals after a session`.
  - `stats tab: add a weekly pages goal, it shows progress after reading`.
- [ ] **Step 2: Sync test:** two devices each write a session offline; after two sync passes both devices hold both sessions; a goal edited on both converges to the newer; a `readMarks` record toggled on both converges by newest `updatedAt`.
- [ ] **Step 3: Docs:** add "Progress and stats checks" to `docs/deploy-and-test.md` for real devices: reading time pauses after 2 min idle; app in background ends the session; time/pages appear on the other device after sync; Saturday week start; goals with a book in two categories; finish prompt; Mark read; very large PDF chapter bars; clock/timezone change on the phone. Update the README status.
- [ ] **Step 4:** run unit, build, full e2e twice → green. **Step 5: Commit** `test: stats e2e, sync convergence, docs`.

---

## Dispatch plan (controller notes)

Branch `plan-4-progress`. Ledger `.superpowers/sdd/2026-11-20-iqra-plan-4-progress-stats/`. Groups (one implementer + one review each, to save tokens): **A** = Task 1 (haiku); **B** = Tasks 2, 3 (sonnet); **C** = Tasks 4, 5 (sonnet); **D** = Task 6 (sonnet). One whole-branch review at the end (sonnet).

## Self-review

- Spec coverage: §9.2 → Task 2; §9.3 → Tasks 1–3; §9.8 Stats tab → Task 4; §9.11 → Task 5; goals (§7 Goal, multi-category) → Tasks 1, 5; sync of sessions/readMarks/goals → Task 6.
- Type consistency: `DayStat`, `GoalProgress`, `SessionSnapshot`, `ReaderSessionHandle`, `formatDuration/formatAvg` each defined once and reused by name.
- Deferred to Plan 5: settings screen for week start/goal defaults, reminders, export. Pause/resume of the 2-minute rule while a modal sheet is open counts as inactivity (no special case).
