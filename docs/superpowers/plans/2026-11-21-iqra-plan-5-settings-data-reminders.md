# Iqra Plan 5: Settings, storage, your data and Calendar reminders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Settings screen (account, storage and downloads, categories, reading defaults, reminders, export/backup/restore, about) and Google Calendar reading reminders.

**Architecture:** One lazy route `/settings` with small section components (each its own file, loaded lazily). Pure modules do the logic (Markdown export, zip writer, backup validation/merge, reminder schedule, quote picking, storage math) and are unit-tested; thin Angular components wire them. Calendar access goes through a `CalendarApi` interface (real fetch adapter + fake for tests) using a **separate, incrementally-granted token** so reminders never affect sign-in or Drive.

**Tech Stack:** Angular 22 signals, Dexie via `Repo`, Google Calendar REST API (fetch), Vitest, Playwright. No new npm dependencies (the zip writer is hand-written, store-only).

**Spec:** `docs/specs/2026-11-14-iqra-design.md` — §9.12 (reminders; owner chose the **Calendar option**), §9.13 (Settings), §9.1 (downloads), §6 (auth/Drive), §7 (Settings, Category), §10 (copy/design). Code from Plans 1–4 is in `app/src/app/`.

## Global Constraints

- **Bundle:** initial total is exactly 500.00 kB. Nothing eager may grow: all new code and ALL new copy live in lazy modules (`settings/settings-copy.ts` etc., never `ui/copy.ts`). The only eager change allowed is enabling the Library gear button as a router link (≤ 0.05 kB; remove an unused icon/string to compensate if needed). Check `npx ng build 2>&1 | grep -i 'initial total'` after every task.
- Copy/tokens/a11y rules from earlier plans: no hard-coded colors, `dir="auto"` on user text, 40 px targets, focus rings, reduced motion, never hard-delete synced records, every destructive action has an Undo toast or a confirm sheet (sign-out clear, restore, remove all downloads use a confirm sheet).
- Reminders (§9.12): single events (not a repeating series), **14 days ahead**, 15 minutes long, popup reminder at start (`minutes: 0`), title `Time to read · <current book title>` (current book = the most recently opened `reading` book; no book → `Time to read`), description = the quote, its source, and a link into the app at the current book. A dedicated calendar named **Iqra** that Iqra creates. Scope `https://www.googleapis.com/auth/calendar.app.created`, requested **only** when the owner turns reminders on (never at sign-in); fallback scope `https://www.googleapis.com/auth/calendar.events` is NOT implemented — if Google rejects the scope, show a clear message and keep reminders off. Keep the 14-day window filled every time the app opens; changing settings rebuilds all future Iqra events. ~40 built-in original motivational lines about reading, no attribution; owner custom lines; "Highlights from my books" shows book and page.
- Settings storage: reading defaults and reminders live in the synced `Settings` record; "Sync on mobile data" and other per-device switches live in `localStorage` (`iqra.device.*`), never synced.
- Gates: `npx ng test --watch=false`, `npx ng build`, `npm run e2e -- --trace off`.

## Review Focus

1. Sign-out with "clear this device" must never delete anything in Drive and must not leave a half-cleared database; cancelling keeps local data.
2. Restore from a bad or hostile file (wrong JSON, wrong schemaVersion, huge, records with missing ids) changes nothing and shows an error; a valid restore never overwrites newer local records.
3. Reminders: no duplicate events when the app is opened repeatedly or on two devices; a revoked/denied Calendar permission turns reminders off with a clear message instead of retry loops; DST and time-zone changes keep the chosen local time.
4. Export: book titles with `/ \ : * ? " < > |`, Arabic text, very long titles, duplicate titles, books with no annotations; no file is generated with an empty/duplicate name.
5. Storage numbers: unlimited Drive quota (no `limit`), `navigator.storage.estimate` unavailable, zero books — no `NaN`, negative or >100 % bars.

---

## File Structure (all under `app/src/app/`)

| File | Responsibility |
|---|---|
| `settings/settings.page.ts` | Settings screen shell, section list |
| `settings/settings-copy.ts` | All Settings copy (lazy) |
| `settings/account.section.ts` | Account, sync, sign-out |
| `settings/defaults.section.ts` | Reading defaults |
| `settings/categories.section.ts` | Categories rename/delete/add/reorder |
| `settings/storage.section.ts`, `settings/storage-math.ts` | Storage bars |
| `settings/downloads.page.ts` | Manage downloads |
| `settings/data.section.ts` | Export / backup / restore UI |
| `data/export-markdown.ts`, `data/zip.ts`, `data/backup.ts` | Pure data tools |
| `reminders/schedule.ts`, `reminders/quotes.ts`, `reminders/builtin-quotes.ts` | Pure reminder logic |
| `reminders/calendar-api.ts`, `reminders/google-calendar.ts`, `reminders/reminder.service.ts` | Calendar adapter + orchestration |
| `settings/reminders.section.ts` | Reminders UI |

---

### Task 1: Settings shell, account and reading defaults

**Files:** Create `settings/settings.page.ts` (+spec), `settings-copy.ts`, `account.section.ts` (+spec), `defaults.section.ts` (+spec), `core/device-prefs.ts` (+spec). Modify `app.routes.ts` (lazy `/settings`, `signedInGuard`), `pages/library/library.page.ts` (enable the gear button as `routerLink="/settings"`), `auth/auth.service.ts` only if sign-out needs a hook.

**Interfaces:**
- Produces:
  ```ts
  // core/device-prefs.ts — per-device switches in localStorage, wrapped in try/catch
  export function getDevicePref<T>(key: string, fallback: T): T;
  export function setDevicePref<T>(key: string, value: T): void;       // key prefix 'iqra.device.'
  // account.section: 'Sync on mobile data' = device pref 'syncOnMobile' (default true)
  ```
  `SettingsPage` (`/settings`): back arrow to Library, title, sections in order: Account, Storage, Categories, Reminders, Reading defaults, Your data, About. Sections not yet built show nothing (later tasks add them, each as a lazily rendered child via `@defer`-free dynamic `import()` + `ViewContainerRef`, same pattern as the book Stats tab).
- **Account section:** name + email (from `AuthApi.profile`), **Sign out** (confirm sheet: "Sign out" keeps local data; checkbox "Also remove Iqra's data from this device" → on confirm: `auth.signOut()`, then if the box was ticked: close Dexie, delete the `iqra` database and downloaded files (`FilesService`/cache API names — read `books/files.service.ts` and `cover-cache.ts`), clear `iqra.*` localStorage keys except `iqra.device.id`, then navigate to `/welcome` with a full reload; nothing in Drive is touched), **Sync now** (`SyncEngine.syncNow()`; shows `status` text and "Last synced <time>" from `lastSyncedAt`, error reason from `lastError`), **Sync on mobile data** toggle; when off, uploads/downloads of PDFs wait for Wi-Fi: gate `UploadQueue` start and `FilesService.download` on `navigator.connection?.type === 'cellular'` (when the Network Information API is missing, never block) with a toast `Waiting for Wi-Fi` — keep the gate in ONE tiny helper `core/network-gate.ts` (`mayUseMobileData(): boolean`) used by both.
- **Reading defaults section:** view (`page`/`reflow`), page color (`readerTheme`), progress mode, page mode, week starts on (Sat/Sun/Mon), each a segmented control bound to `SettingsService.update`. Existing per-book values are unchanged; defaults apply to books opened for the first time afterwards (verify `SettingsService` defaults are already read by import; if not, apply them at import).
- [ ] **Step 1: Write failing tests:** device prefs get/set/fallback with localStorage throwing; account section shows name/email, Sync now calls `syncNow`, sign out without the checkbox calls only `auth.signOut` (spy on a `clearDevice` helper: not called); with the checkbox it calls it exactly once after sign-out and navigates to `/welcome`; cancel does nothing; defaults section writes `weekStartsOn: 1` when Monday is chosen; `mayUseMobileData()` is false only when the pref is off AND `connection.type === 'cellular'`; settings route is lazy and guarded; the gear button on Library links to `/settings`.
- [ ] **Step 2: Run** `cd app && npx ng test --watch=false --include='**/settings/**' --include='**/device-prefs.spec.ts'` → FAIL. **Step 3: Implement.** **Step 4:** unit + build (bundle ≤ 500.00) green. **Step 5: Commit** `feat: settings screen with account and reading defaults`.

---

### Task 2: Categories management

**Files:** Create `settings/categories.section.ts` (+spec). Modify nothing eager.

**Interfaces:** Consumes `Repo`, `Category` (`name`, `order`), `Book.categoryIds`. Produces:
- Pure helpers in `settings/category-order.ts` (+spec): `moveCategory(list: Category[], from: number, to: number): Category[]` returning new `order` values `0..n-1` only for changed items; `nextOrder(list): number`; `normalizeName(raw: string): string` (trim, collapse spaces, max 40 chars, `''` when empty).
- Section: list sorted by `order` with a drag handle (pointer-drag reorder with a drag preview) **and** up/down buttons (≥ 40 px) for accessibility/keyboard; rename inline (Enter saves, Esc cancels; duplicate names allowed case-insensitively? NO — reject a case-insensitive duplicate with an inline message); **Delete** soft-deletes the category and removes its id from every book's `categoryIds` and from any `Goal.categoryId` pointing to it is NOT changed (Stats already labels it "category removed"); shows an Undo toast restoring the category and the book links (capture the affected book ids); "Add category" field.
- [ ] **Step 1: Write failing tests:** `moveCategory` from 0 to 2 in `[A,B,C]` → `[B,C,A]` with `order` `0,1,2`; moving to the same index changes nothing (empty patch); `normalizeName('  a   b ')` = `'a b'`, 60-char name truncated to 40; rename to an existing name (case-insensitive) is rejected; delete removes the category from two books and Undo restores both books and the category; add with `''` does nothing; reorder persists `order` through `Repo.put`.
- [ ] **Step 2–4:** run → FAIL, implement, unit + build green. **Step 5: Commit** `feat: category management in settings`.

---

### Task 3: Storage and downloads

**Files:** Create `settings/storage-math.ts` (+spec), `settings/storage.section.ts` (+spec), `settings/downloads.page.ts` (+spec). Modify `app.routes.ts` (lazy `/settings/downloads`).

**Interfaces:**
- Pure:
  ```ts
  export interface Segment { label: 'books'|'other'|'free'|'downloads'|'data'|'app'; bytes: number; fraction: number }
  export function driveSegments(q: { limit: number; usage: number }, booksBytes: number): Segment[];
  // books = min(booksBytes, usage); other = usage - books; free = max(0, limit - usage); unlimited (non-finite limit) → no 'free' segment, fractions of usage; zero total → []
  export function deviceSegments(est: { usage?: number; quota?: number } | null, downloadedBytes: number): Segment[];
  // downloads = min(downloadedBytes, usage); data+app = remainder split as one 'data' segment; est null → just downloads
  export function formatBytes(n: number): string;  // '0 B', '1.4 MB', '12 GB'; negative/NaN → '0 B'
  ```
- Section: Drive usage stacked bar (`DriveAdapter.storageQuota()`; booksBytes = sum of `sizeBytes` of live books) with legend and text, loading and error states (`Couldn't load Drive usage` + Retry), device usage from `navigator.storage.estimate()` plus `FilesService.downloaded()` sizes, and a **Manage downloads** link.
- `DownloadsPage`: list of downloaded books (title, size, last opened), sorted by size descending, each with **Remove download** (uses `FilesService.removeLocal`; Undo toast re-downloads only if the book is still available — if read of `removeLocal` shows a different convention, follow it), a header with total size and **Remove all downloads** (confirm sheet), empty state `No books are downloaded on this device.`
- [ ] **Step 1: Write failing tests:** `driveSegments({limit: 100, usage: 40}, 10)` → books 10, other 30, free 60 with fractions `0.1/0.3/0.6`; unlimited limit → no free and fractions sum to 1; `booksBytes` > usage clamped; zero → `[]`; `formatBytes(1_468_006)` = `'1.4 MB'`; `deviceSegments(null, 5e6)` = just downloads; sections show loading → data → error + Retry; downloads page sorted by size, remove calls `removeLocal` once, remove all asks to confirm.
- [ ] **Step 2–4:** run → FAIL, implement, unit + build green. **Step 5: Commit** `feat: storage overview and download management`.

---

### Task 4: Your data — Markdown export, backup and restore

**Files:** Create `data/zip.ts`, `data/export-markdown.ts`, `data/backup.ts` (+ a spec each), `settings/data.section.ts` (+spec).

**Interfaces:**
- ```ts
  // zip.ts — store-only ZIP (method 0), UTF-8 names (flag bit 11), CRC-32, DOS date/time
  export function zipFiles(files: { name: string; data: Uint8Array }[], now?: Date): Uint8Array;
  export function crc32(data: Uint8Array): number;
  // export-markdown.ts
  export function safeFileName(title: string, used: Set<string>): string;           // strips / \ : * ? " < > | and control chars, trims dots/spaces, max 80 chars, '' → 'Untitled', collisions get ' (2)', ' (3)'; always ends with '.md'
  export function bookMarkdown(book: Book, anns: Annotation[], bookmarks?: boolean): string;
  export function exportNotes(books: Book[], anns: Annotation[]): { name: string; data: Uint8Array }[]; // only books with ≥1 non-bookmark annotation, sorted by title
  // backup.ts
  export const BACKUP_VERSION = 1;
  export function buildBackup(tables: Partial<Record<TableName, SyncRecord[]>>, now: number): { schemaVersion: 1; exportedAt: number; tables: ... };
  export function parseBackup(text: string): { ok: true; tables: Partial<Record<TableName, SyncRecord[]>> } | { ok: false; error: 'not-json'|'wrong-version'|'bad-shape'|'too-large' };
  export function mergeInto(existing: SyncRecord[], incoming: SyncRecord[]): SyncRecord[]; // the sync merge rule (reuse `sync/merge.ts`): higher updatedAt wins, tie → higher deviceId
  ```
  Markdown layout per book: `# <title>` + `*<author>*`, then `## Highlights and notes` grouped by page ascending: each `> quote` (blockquote, multi-line safe) followed by the note body and `#tags`; side notes as `**Side note (p. N)** body`; summaries under `## Summaries` with their scope label (`Book`, chapter title, `p. a–b`); areas as `*Area highlight on p. N*` + note; bookmarks under `## Bookmarks` as `- p. N · <chapter>`. Deleted records are excluded. Arabic text is written as-is.
  Backup includes every table's records (including tombstones) but NOT PDFs or covers; `parseBackup` rejects > 50 MB text, non-object, `schemaVersion !== 1`, records without a string `id`/numeric `updatedAt`, and unknown table names (ignored, not an error).
- **Data section UI:** "Export notes (Markdown zip)" → `iqra-notes-YYYY-MM-DD.zip` downloaded via `Blob` + anchor; "Back up everything" → `iqra-backup-YYYY-MM-DD.json`; "Restore from a backup" → file picker → parse → confirm sheet showing counts ("N books, N annotations …", "newer data on this device is kept") → merge each table with `mergeInto` + `Repo.applyRemote`, then `SyncEngine.syncNow()`; errors show a clear message and change nothing.
- [ ] **Step 1: Write failing tests:** `crc32(utf8('123456789')) === 0xCBF43926`; a zip of two files round-trips through a tiny test unzip helper inside the spec (read local headers) with names and bytes intact, Arabic file name preserved; `safeFileName('a/b:c?', new Set())` = `'a b c.md'` (each forbidden character becomes a space, then spaces collapse and trim); duplicate titles → `'Dune.md'`, `'Dune (2).md'`; 200-char title truncated to 80 before `.md`; `''` → `'Untitled.md'`; `bookMarkdown` for one highlight with a note and tags matches the exact expected string; deleted annotations excluded; book with only a bookmark is not exported by `exportNotes`; `parseBackup` error cases (`not-json`, `wrong-version`, `bad-shape`, `too-large`) and a valid round trip with `buildBackup`; `mergeInto` keeps the newer of two records and keeps records unique to either side; restore never replaces a newer local record (component test with fake DB); a failed parse leaves tables untouched.
- [ ] **Step 2–4:** run → FAIL, implement, unit + build green. **Step 5: Commit** `feat: notes export, backup and restore`.

---

### Task 5: Reminder core and Calendar adapter

**Files:** Create `reminders/schedule.ts`, `quotes.ts`, `builtin-quotes.ts`, `calendar-api.ts`, `google-calendar.ts`, `reminder.service.ts` (+ specs). Modify `core/models.ts` (type `Settings.reminders` as `ReminderSettings`; keep it backward-compatible with `{}` — all fields optional with defaults), `auth/auth.service.ts` (+`FakeAuth`).

**Interfaces:**
- ```ts
  // models: ReminderSettings (spec §9.12)
  export interface ReminderSettings { enabled?: boolean; days?: (0|1|2|3|4|5|6)[]; time?: string; quoteSource?: 'highlights'|'builtin'|'both'; customQuotes?: string[]; calendarId?: string }
  // schedule.ts (pure)
  export function reminderSlots(now: Date, r: ReminderSettings, horizonDays = 14): Date[]; // local date+time for each selected weekday in the next 14 days, strictly in the future; invalid time → []
  export function eventId(slot: Date): string;          // 'iqra' + 'YYYYMMDDHHmm' local time; Calendar event ids allow only a-v and 0-9, and all of i,q,r,a are in that range
  // quotes.ts
  export function pickQuote(opts: { source: 'highlights'|'builtin'|'both'; custom: string[]; highlights: { quote: string; bookTitle: string; page: number }[]; builtin: string[]; seed: number }): { text: string; source?: string };
  // deterministic: same seed → same quote; seed = the slot's day number; highlights with quote shorter than 20 or longer than 280 chars are skipped; empty pools fall back to builtin; `source` = 'Title, p. N' for highlights
  // builtin-quotes.ts: export const BUILTIN_QUOTES: string[] // exactly 40 short, original lines about reading, each ≤ 120 chars, no attribution, no real-person quotes
  // calendar-api.ts
  export interface CalendarEvent { id: string; startsAt: string /* ISO with offset */; endsAt: string; title: string; description: string }
  export interface CalendarApi {
    ensureCalendar(existingId?: string): Promise<string>;       // creates a secondary calendar summary 'Iqra' (+ time zone) if missing
    listFutureEvents(calendarId: string): Promise<{ id: string; start: string }[]>;
    insert(calendarId: string, e: CalendarEvent): Promise<'created' | 'exists'>;   // 409 → 'exists'
    remove(calendarId: string, id: string): Promise<void>;       // 404/410 → ok
  }
  export const CALENDAR_API = new InjectionToken<CalendarApi>('calendar');
  export class CalendarAuthError extends Error {}               // 401/403/scope rejected
  // AuthApi gains:
  //   requestScope(scope: string): Promise<string>   // user gesture; returns an access token for ONLY that scope (separate token client, kept in memory with expiry); rejects AuthCancelledError / CalendarAuthError-like on denial
  //   scopeToken(scope: string): string | null        // valid cached token or null (no popups)
  // reminder.service.ts
  @Injectable({ providedIn: 'root' }) class ReminderService {
    enable(): Promise<'ok' | 'denied' | 'cancelled'>;   // user gesture: requestScope → ensureCalendar → save calendarId & enabled → fill()
    disable(opts?: { removeEvents: boolean }): Promise<void>;
    fill(): Promise<{ created: number; removed: number } | 'needs-permission'>; // keeps the 14-day window filled using the cached scope token only; idempotent
    rebuild(): Promise<...>;                              // after a settings change: removes all future Iqra events then fills
  }
  ```
  `google-calendar.ts` implements `CalendarApi` with `fetch` to `https://www.googleapis.com/calendar/v3/...` (calendars.insert, events.list with `timeMin=now`, events.insert with `{ id, summary, description, start: {dateTime, timeZone}, end, reminders: {useDefault: false, overrides: [{method: 'popup', minutes: 0}]} }`, events.delete), 10 s timeout per request, 401/403 → `CalendarAuthError`, 429/5xx → retry once after 1 s then throw. Event window `[start, start+15 min]`. `fill()` runs at most once per app start and is skipped when `enabled` is false; it removes Iqra events that are no longer in the slot list (changed days/time) and inserts missing ones; two devices doing it concurrently are safe because event ids are deterministic (`exists` is success).
- [ ] **Step 1: Write failing tests:** `reminderSlots` for days `[6,0,1,2,3,4]` (Sat–Thu), time `'21:30'`, now = Wed 2026-11-18 22:00 → first slot Sat 2026-11-21 21:30, none for Fri, total slots equal the count of selected weekdays in the 14 days after now, none in the past, and one on the DST-change day still at 21:30 local; invalid `'25:99'` → `[]`; `eventId(new Date(2026,10,21,21,30))` = `'iqra202611212130'`; `pickQuote` determinism, source label for highlights `'Dune, p. 11'`, short/long highlights skipped, empty custom + empty highlights falls back to builtin, `both` draws from the union; `BUILTIN_QUOTES.length === 40` and each ≤ 120 chars; ReminderService with `FakeCalendar`: first `fill()` inserts N events, a second `fill()` inserts 0 (idempotent), changing days removes the stale future events and adds new ones (`rebuild`), `enable()` with a denied permission returns `'denied'` and leaves `enabled` false, a `CalendarAuthError` during `fill()` sets `enabled: false` and returns `'needs-permission'` without retrying, title uses the current reading book's title (or `Time to read` without one), description contains the quote, the source and a link ending in `/read/<bookId>`.
- [ ] **Step 2–4:** run → FAIL, implement (`FakeAuth.requestScope` returns a fake token), unit + build green. **Step 5: Commit** `feat: Google Calendar reading reminders core`.

---

### Task 6: Reminders UI and app-open fill

**Files:** Create `settings/reminders.section.ts` (+spec). Modify `app.ts`/`app.component.ts` only to call `ReminderService.fill()` lazily after sign-in (dynamic `import()` guarded by `settings().reminders?.enabled`, so no eager growth), `docs/setup-google.md`.

**Interfaces:** Consumes Task 5. Produces the Reminders section:
- Master switch (turning on = `ReminderService.enable()` from the click handler; while waiting shows `Connecting to Google Calendar…`; `denied` → `Google didn't allow calendar access. Reminders stay off.`; `cancelled` → quiet, stays off), day toggles Sat…Fri in the user's week order (≥ 40 px each), time input (`<input type="time">`), quote source (`Highlights from my books` / `Built-in quotes` / `Both`), custom lines (add/remove list, max 20, each ≤ 120 chars), a note `Reminders appear in your "Iqra" calendar`, **Send a test reminder** (creates one event 2 minutes ahead; Calendar shows a popup), status line (`Next: Sat 21:30` from `reminderSlots`), `needs-permission` state with a **Reconnect Calendar** button. Every change calls `SettingsService.update` (debounced 600 ms) then `ReminderService.rebuild()`. When turned off: confirm sheet `Remove upcoming reminders from the calendar?` with Yes/No → `disable({removeEvents})`.
- `docs/setup-google.md`: add the step to add the scope `https://www.googleapis.com/auth/calendar.app.created` to the OAuth consent screen's scopes and enable the **Google Calendar API** in the Cloud project; note it is a sensitive scope so testing users see the unverified-app warning.
- [ ] **Step 1: Write failing tests:** toggling on calls `enable()` once (click handler, not an effect) and shows the connecting state; denied message; day toggles update `days`; invalid custom line (empty/too long) rejected; changing the time triggers one debounced `rebuild`; off + confirm "No" keeps events; the next-reminder line matches `reminderSlots`; app-open `fill()` is not called when reminders are disabled and is called once when enabled; the section is not in the initial bundle (route/lazy import only).
- [ ] **Step 2–4:** run → FAIL, implement, unit + build green. **Step 5: Commit** `feat: reminder settings and calendar fill on app open`.

---

### Task 7: End-to-end, sync, docs

**Files:** Create `app/e2e/settings.spec.ts`; modify `docs/deploy-and-test.md`, `README.md`.

- [ ] **Step 1: e2e tests** (existing harness; `FakeAuth`/`FakeDrive`/`FakeCalendar` as the app's test mode already wires): settings opens from the Library gear; categories add/rename/reorder/delete with Undo; storage section shows both bars; manage downloads removes one; export notes downloads a zip whose name matches `iqra-notes-\d{4}-\d{2}-\d{2}\.zip` and contains one `.md` for a book with a highlight (read the download with `unzip -l`-style parsing in the test or check size > 0 and the first bytes `PK`); backup downloads JSON; restore of that JSON onto a fresh context brings the data back; restore of garbage shows an error; reading defaults persist after reload; reminders on → events appear in the fake calendar; changing time rebuilds; sign out with "remove data" lands on welcome with an empty IndexedDB.
- [ ] **Step 2: Sync test** in `sync/sync-engine.spec.ts`: Settings record edited on two devices converges to the newer one (including `reminders`); a restored (older) record never replaces a newer synced one.
- [ ] **Step 3: Docs:** `docs/deploy-and-test.md` "Settings and reminders checks" for real devices: turning reminders on grants the Calendar permission and creates the "Iqra" calendar; the popup arrives on the phone at the chosen time with the quote; changing days/time rebuilds; two devices do not duplicate events; sign out and clear; restore on a second device; mobile-data toggle on cellular; large library storage numbers match Google Drive's. README status.
- [ ] **Step 4:** run unit, build, full e2e twice → green. **Step 5: Commit** `test: settings e2e, settings sync, docs`.

---

## Dispatch plan (controller notes)

Branch `plan-5-settings`. Ledger `.superpowers/sdd/2026-11-21-iqra-plan-5-settings/`. Groups: **A** = Tasks 1, 2; **B** = Tasks 3, 4; **C** = Tasks 5, 6 (reviewed separately: auth + Calendar); **D** = Task 7. Token saving: sonnet implementers, review only after Group C, then one whole-branch review (sonnet).

## Self-review

- Spec coverage (§9.13 Account/Storage/Categories/Reminders/Reading defaults/Your data/About; §9.12 Calendar option) → Tasks 1–6; About (version, link to Drive folder) is part of Task 1's shell (a small static section: version from `package.json`, Drive folder link `https://drive.google.com/drive/my-drive` search for the Iqra folder is not possible without its id — use the folder id from `ensureBooksFolder()`'s parent: link `https://drive.google.com/drive/folders/<Iqra folder id>`; if unknown hide the link).
- Types: `ReminderSettings`, `CalendarApi`, `Segment`, `BACKUP_VERSION` defined once.
- Deferred: in-app nudge fallback (not chosen), Cloudflare push (not chosen), Language Notebook, OCR, TTS.
