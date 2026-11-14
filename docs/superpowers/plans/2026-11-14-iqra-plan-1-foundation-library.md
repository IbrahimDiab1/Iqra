# Iqra Plan 1: Foundation and Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installable, offline-capable Angular PWA where the owner signs in with Google, adds PDFs (uploaded to their Drive), and sees the same library on every device. Books can be downloaded, streamed, removed from a device, or deleted everywhere. Book details can be edited. Opening a book shows a minimal page-1 viewer, which Plan 2 replaces.

**Architecture:** Serverless. The UI reads and writes only IndexedDB (Dexie). A sync engine merges records with Google Drive's hidden `appDataFolder`, record by record, newest `updatedAt` wins. PDFs live in `My Drive/Iqra/Books`. Google Identity Services provides the access token in the browser, and every Drive call goes through one `DriveAdapter` interface with a fake implementation for tests.

**Tech Stack:**
- Angular (latest stable, ≥ 20): standalone components, signals, `@if`/`@for`, Vitest via `ng test`.
- `@angular/service-worker`.
- Dexie 4 and `fake-indexeddb` for tests.
- `pdfjs-dist` and `pdf-lib` (development only, for generating test fixtures).
- Playwright.
- Fonts from `@fontsource-variable/literata`, `@fontsource/instrument-sans` and `@fontsource/ibm-plex-sans-arabic`.

**Spec:** `docs/specs/2026-11-14-iqra-design.md`. Read §5–§9.1, §9.7, §9.8 (Details tab only) and §10 before starting.

## Roadmap (separate plans, written after this one ships)
- **Plan 2:** Reader (page view, reading mode, swipe and scroll, zoom, Back/Forward through jumps, open at last position, search in book).
- **Plan 3:** Annotations (selection, highlights, notes, areas, side notes, summaries, bookmarks, Contents & notes panel, Notes hub).
- **Plan 4:** Reading sessions, progress (including chapters), weekly goals, Stats tab, book Stats tab.
- **Plan 5:** Settings, storage, Manage downloads, export and backup, reminders.
- **Phase 2 and 3:** Language Notebook, OCR, text-to-speech.

## Global Constraints
- Running cost is $0. Do not add any server, paid API or analytics.
- The UI never waits on the network, except to download or stream a PDF the device doesn't have.
- Every synced record carries `SyncMeta { id, updatedAt, deviceId, deleted? }`. Never hard-delete a synced record; set `deleted: true`.
- Google scopes are exactly `openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata`. Calendar is added in Plan 5, and only when reminders are turned on.
- Drive layout: PDFs go in `My Drive/Iqra/Books/` with `appProperties.iqraBookId`. JSON and covers go in `appDataFolder`.
- Downloads happen only when the owner asks. Opening a book that isn't downloaded shows the open sheet (Task 15).
- **Execution order:** 0–12, then 14, 15, 16, 17, then 13 (the Library page uses the sheets from 15 and 17), then 18 and 19.
- No confirmation dialogs for undoable actions. Use an undo toast (4 s by default; 10 s for "Delete everywhere").
- Any user text that can be Arabic (titles, authors, tags, notes) renders with `dir="auto"`. Arabic glyphs use the Arabic font through the font stack.
- Copy comes only from `src/app/ui/copy.ts` (Task 2). Don't invent strings.
- Colors, spacing and type come only from the CSS tokens in Task 2. Don't use literal colors in components.
- Touch targets are at least 40 px, every control shows a visible focus ring, and animations are off when the system's reduce-motion setting is on (`prefers-reduced-motion`).
- Platforms: Android Chrome and Windows Chrome/Edge. iOS isn't a target.

## Review Focus
1. **A book synced from another device before its PDF finished uploading** (`driveFileId === ''`). Its card shows "Uploading from another device", tapping it does nothing except a toast, and nothing crashes. Test in Task 15.
2. **The token expires or Drive returns 401 in the middle of sync.** The status becomes `paused`, dirty flags are kept, nothing is lost, and the next `syncNow()` after reconnecting pushes everything. Test in Task 9.
3. **The same PDF is added on two devices while both are offline.** After sync, one book remains (the earlier `addedAt`). The other is tombstoned, and its Drive file is queued for deletion. Test in Task 9.
4. **A batch of files with a broken, password-protected or non-PDF file in it.** That file gets a toast naming it ("<name> couldn't be added: it isn't a readable PDF."), and the other files are still added. Test in Task 10.
5. **A sync file that is corrupt JSON or has a newer `schemaVersion`.** That file is never overwritten, the other files still sync, and the status becomes `error` with a readable reason. Test in Task 9.

---

## File structure (all paths relative to `iqra/app/`)

```
src/app/
  app.config.ts, app.routes.ts, app.component.ts            shell + routes
  core/models.ts            spec §7 types used in this plan
  core/ids.ts               newId(), getDeviceId()
  core/clock.ts             Clock token (now()) for testable time
  core/db.ts                Dexie schema (IqraDb)
  core/repo.ts              Repo: put / softDelete stamping SyncMeta, change events
  sync/shards.ts            record → Drive file name mapping
  sync/merge.ts             pure merge + tombstone pruning + duplicate books
  sync/drive-adapter.ts     DriveAdapter interface + DriveFileInfo
  sync/fake-drive.ts        in-memory adapter (tests, e2e, dev)
  sync/google-drive.ts      fetch-based adapter
  sync/sync-engine.ts       pull/push/scheduler/status
  sync/sync-status.component.ts
  auth/auth.service.ts      GIS token client
  auth/welcome.page.ts
  books/import/hash.ts, pdf-meta.ts, cover.ts, import.service.ts
  books/upload-queue.ts
  books/files.service.ts    download / stream / remove local / delete everywhere
  books/library/library-query.ts, library.page.ts, book-card.component.ts,
                continue-card.component.ts, filter-sheet.component.ts, sort-menu.component.ts
  books/open-book.sheet.ts, remove-book.sheet.ts
  books/details/book-details.sheet.ts
  reader/reader-stub.page.ts
  ui/tokens.css, ui/copy.ts, ui/icons.ts, ui/sheet.component.ts, ui/toast.service.ts, ui/toast.component.ts
e2e/library.spec.ts, e2e/fixtures/make-fixtures.mjs
```

---

### Task 0: Google Cloud setup (owner, manual, ~15 min)

**Files:** Create `iqra/docs/setup-google.md` containing these steps.

- [ ] **Step 1:** At console.cloud.google.com, create a project named "Iqra" and enable the **Google Drive API**.
- [ ] **Step 2:** Set up the OAuth consent screen: user type External, app name "Iqra", the 4 scopes from Global Constraints, add your own account as a test user, then **Publish app** (status "In production"). The app stays unverified, which is fine for personal use. You'll click through the "unverified app" notice once.
- [ ] **Step 3:** Create credentials → OAuth client ID → Web application. Authorized JavaScript origins: `http://localhost:4200` and `https://<github-user>.github.io`. Copy the client ID.
- [ ] **Step 4:** Verify: the client ID ends in `.apps.googleusercontent.com`. It goes into `environment.ts` in Task 1. It isn't a secret.

### Task 1: Project scaffold, PWA, fonts, test runners

**Files:**
- Create the project with `npx @angular/cli@latest new app --style=css --ssr=false --routing` (choose Vitest if asked) inside `iqra/`.
- Create `src/environments/environment.ts` with `{ production: false, googleClientId: '923189502083-5kgqcp0d9v2osc0b6qqi5e98clklo8ri.apps.googleusercontent.com', fakeDrive: false }`, plus `environment.prod.ts` and `environment.e2e.ts` (`fakeDrive: true`).
- Modify `angular.json`:
  - Add the `e2e` configuration with a file replacement.
  - Add an assets glob copying `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` to `assets/`.

**Steps:**
- [ ] **Step 1:** Run `git init` in `iqra/`, then install:
  - Packages: `dexie pdfjs-dist @fontsource-variable/literata @fontsource/instrument-sans @fontsource/ibm-plex-sans-arabic`.
  - Dev packages: `fake-indexeddb pdf-lib @playwright/test`.
- [ ] **Step 2:** Run `npx ng add @angular/service-worker`. In `ngsw-config.json`:
  - The `app` asset group uses `installMode: prefetch` and includes `/assets/pdf.worker.min.mjs` and `/**/*.woff2`.
  - Add no dataGroups. Drive calls must never be cached by the service worker.
- [ ] **Step 3:** Fill in `manifest.webmanifest`: name "Iqra", short_name "Iqra", `display: standalone`, `theme_color #1E6B64`, `background_color #FBFCFB`, icons at 192 and 512 (a plain teal square with a white "I", generated as PNG).
- [ ] **Step 4:** Add `src/test-setup.ts` containing `import 'fake-indexeddb/auto';` and register it in the test builder's `setupFiles`.
- [ ] **Step 5:** Run `npx ng test --watch=false`. Expected: the default spec passes. Run `npx ng build`. Expected: success, and `ngsw.json` exists in the output.
- [ ] **Step 6:** Commit with message `chore: scaffold Iqra PWA`.

### Task 2: Design tokens, copy, icons, sheet, toast, app shell

**Files:**
- Create: `src/app/ui/tokens.css` (imported from `styles.css`), `ui/copy.ts`, `ui/icons.ts`, `ui/sheet.component.ts`, `ui/toast.service.ts`, `ui/toast.component.ts`.
- Modify: `app.component.ts`, `app.routes.ts`.
- Test: `ui/toast.service.spec.ts`, `ui/sheet.component.spec.ts`.

**Interfaces — Produces:**
- `ToastService.show(message: string, opts?: { undo?: () => void; durationMs?: number }): void`. One toast at a time; a new one replaces the old. The default duration is 4000 ms.
- `<f-sheet [open]="bool" [title]="string" [tall]="bool" (closed)="...">` with content projection, plus a footer slot `[sheet-foot]`.
- `COPY` (a typed const object), `icon(name: IconName, size = 22): string` (SVG markup).
- Routes:

  | Path | Page |
  |---|---|
  | `/welcome` | Welcome |
  | `/library` | Library (default) |
  | `/notes` | placeholder "Coming in Plan 3" |
  | `/stats` | placeholder |
  | `/read/:bookId` | reader stub |

  The tab bar (Library, Notes, Stats) is hidden on `/read/*` and `/welcome`. The Words tab arrives in phase 2.

**Tokens.** Copy these verbatim from the prototype's `:root` and both dark blocks (`iqra/folio-prototype.html`, lines 9–76):
- **Light:** `--bg #E9ECEA; --surface #FBFCFB; --surface-2 #F0F3F1; --line #DCE2DF; --fg #19211F; --muted #5D6A66; --accent #1E6B64; --accent-fg #FFFFFF; --accent-soft #DCEDEA; --danger #A8433F; --ok #2F8F5B; --warn #C98A1B; --tool-bg #1D2423; --tool-fg #F2F5F4; --undo #8FD8CE`.
- **Dark:** `--bg #0E1211; --surface #161B1A; --surface-2 #1E2524; --line #2B3533; --fg #E6ECEA; --muted #97A5A1; --accent #63BDB2; --accent-fg #0B1514; --accent-soft #1B3532; --danger #E08480; --ok #5CC28A; --warn #E2AE4E; --tool-bg #2A3331`.
- **Fonts:** `--ui: "Instrument Sans", "IBM Plex Sans Arabic", system-ui, sans-serif; --book: "Literata Variable", "IBM Plex Sans Arabic", Georgia, serif`.
- **Radii:** 12px for controls, 18px for cards, 22px for the sheet's top corners.
- **Motion:** sheet 300ms `cubic-bezier(.2,.8,.2,1)`; toast 180ms.
- **Spacing:** the page gutter is 18px.

Use the same theme pattern as the prototype: the `prefers-color-scheme` media block, plus `[data-theme]` overrides.

**Copy (`COPY`, exact strings):**
```ts
export const COPY = {
  welcome: { title: 'Your books, on every device', body: 'Iqra keeps your PDFs in your own Google Drive and your notes in sync. Reading always works offline.', cta: 'Continue with Google', offline: 'Connect to the internet once to sign in. After that, Iqra works offline.' },
  sync: { synced: 'Synced with Google Drive', saving: 'Saved on this device · syncing', offline: 'Offline · changes are saved on this device', paused: 'Sync paused · Tap to reconnect', error: 'Sync failed · Tap to retry' },
  library: { title: 'Library', add: 'Add PDF', tabs: { reading: 'Reading', 'to-read': 'To read', finished: 'Finished', all: 'All' }, paused: 'Paused', upNext: 'Up next', continue: 'Continue reading', resume: 'Resume', filter: 'Filter', sort: 'Sort', emptyAll: 'No books yet. Add a PDF to start your library.', emptyFiltered: 'No books match these filters.', clearFilters: 'Clear filters', uploadingElsewhere: 'Uploading from another device', notStarted: 'Not started', finished: 'Finished' },
  sort: { 'recent-read': 'Recently read', 'recent-added': 'Recently added', progress: 'Progress', priority: 'Priority', rating: 'Rating', title: 'Title' },
  filter: { title: 'Filter', categories: 'Categories', tags: 'Tags', minRating: 'Minimum rating', downloadedOnly: 'Downloaded only', apply: 'Show books', reset: 'Reset' },
  import: { duplicate: (n: string) => `${n} is already in your library`, unreadable: (n: string) => `${n} couldn't be added: it isn't a readable PDF.`, added: (c: number) => c === 1 ? 'Book added' : `${c} books added`, uploading: (p: number) => `Uploading to Drive · ${p}%` },
  open: { title: 'This book isn’t on this device', stream: 'Read from Google Drive', streamHint: 'Opens now. Nothing is saved on this device.', download: 'Download to this device', downloadHint: (mb: string) => `${mb} MB · available offline`, offline: 'Connect to the internet to read it from Drive or download it.', downloading: (p: number) => `Downloading · ${p}%`, failed: 'Download failed. Check your connection and try again.' },
  remove: { title: 'Remove book', device: 'Remove from this device', deviceHint: 'Frees space. The book and your notes stay in your library.', everywhere: 'Delete everywhere', everywhereHint: 'Removes the book, its notes and the PDF in Google Drive from all your devices.', removedDevice: 'Removed from this device', deleted: (t: string) => `Deleted ${t}` },
  details: { title: 'Book details', tabDetails: 'Details', tabStats: 'Stats', titleLabel: 'Title', author: 'Author', status: 'Status', categories: 'Categories', newCategory: 'New category', tags: 'Tags', tagPlaceholder: 'New tag, then press Enter', rating: 'Rating', review: 'Review', reviewPlaceholder: 'What did you think?', upNext: 'In Up next', progressMode: 'Track progress by', lastPage: 'Last page reached', marked: 'Pages I mark as read', pageMode: 'Turn pages by', swipe: 'Swiping', scroll: 'Scrolling', file: 'File', onDevice: 'On this device', notDownloaded: 'Not downloaded', download: 'Download', removeDownload: 'Remove download', remove: 'Remove book', save: 'Save', saved: 'Book details saved', statsSoon: 'Reading stats arrive with Plan 4.' },
  status: { reading: 'Reading', 'to-read': 'To read', paused: 'Paused', finished: 'Finished' },
  common: { undo: 'Undo', cancel: 'Cancel', close: 'Close' },
} as const;
```

- [ ] **Step 1: Write the failing test** in `toast.service.spec.ts`:
  - `show('A')` then `show('B')` → `current()?.message === 'B'`.
  - After 4000 ms (fake timers), `current()` is `null`.
  - `show('X', { undo: spy })` then `undo()` → `spy` called once, and `current()` is `null`.
- [ ] **Step 2:** Run `npx ng test --watch=false`. Expected: FAIL (the module doesn't exist yet).
- [ ] **Step 3: Implement `ToastService`** with `current: Signal<{ message: string; undo?: () => void } | null>`, `show()`, `undo()` and `dismiss()`.
- [ ] **Step 4: Write the sheet test:**
  - An open sheet renders its projected content.
  - Pressing Escape emits `closed`.
  - Clicking the scrim emits `closed`.
  - At viewport width ≥ 720 px, the panel has the class `dialog` (a centered card, max-width 480 px). Otherwise it's a bottom sheet.
- [ ] **Step 5: Implement `SheetComponent`** with:
  - A grab bar.
  - A header holding the title and a close button (`aria-label="Close"`).
  - A scrollable body.
  - A footer slot.
  - `role="dialog" aria-modal="true"`.
  - On open, focus the first focusable element in the body.
- [ ] **Step 6: Build the shell.** `AppComponent` renders `<router-outlet>`, the tab bar (icons `library`, `notes`, `stats` from `icons.ts`, using the same SVG paths as the prototype), and `<f-toast>`. Run the tests, then `npx ng serve`, and confirm the tabs switch routes.
- [ ] **Step 7:** Commit with message `feat: design tokens, copy, sheet, toast, shell`.

### Task 3: Models, ids, clock

**Files:** Create `core/models.ts`, `core/ids.ts`, `core/clock.ts`. Test: `core/ids.spec.ts`.

**Interfaces — Produces:**
- `models.ts`: copy from spec §7 exactly: `ID, SyncMeta, Book, OutlineNode, Category, UpNext, Settings` (`Settings.reminders` may be typed `unknown` until Plan 5), `Position, ReadMark, Annotation, ReadingSession`. Add:
  ```ts
  export type TableName = 'books'|'categories'|'upNext'|'goals'|'settings'|'annotations'|'positions'|'readMarks'|'sessions'|'words';
  export type SyncRecord = SyncMeta & Record<string, unknown>;
  ```
- `ids.ts`: `newId(): string` (wraps `crypto.randomUUID()`), and `getDeviceId(): string` (reads `localStorage['iqra.deviceId']` or creates and stores one; it is the same on every call).
- `clock.ts`: `export const CLOCK = new InjectionToken<{ now(): number }>('clock', { factory: () => ({ now: () => Date.now() }) })`.

- [ ] **Step 1: Test.** `getDeviceId()` returns the same value on two calls, and returns a new value after `localStorage.clear()`.
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat: core models and ids`.

### Task 4: Local database and repository

**Files:** Create `core/db.ts`, `core/repo.ts`. Test: `core/repo.spec.ts`.

**Interfaces — Produces:**
- `IqraDb extends Dexie`, database name `iqra`, version 1. Stores:
  ```
  books: 'id, updatedAt, sha256, status, lastOpenedAt, addedAt'
  categories: 'id', upNext: 'id', goals: 'id', settings: 'id',
  annotations: 'id, bookId, updatedAt', positions: 'id, bookId', readMarks: 'id, bookId',
  sessions: 'id, bookId, startedAt', words: 'id',
  pdfFiles: 'bookId',                 // { bookId, blob, sizeBytes, savedAt } — device only
  covers: 'bookId',                   // { bookId, blob } — device cache of cover JPEGs
  syncState: 'shard',                 // { shard, remoteId?, remoteModified?, dirty: boolean, error?: string }
  pendingUploads: 'id, bookId',       // { id, bookId, kind: 'pdf'|'cover', attempts }
  pendingDriveDeletes: 'fileId'       // { fileId, notBefore }
  ```
- `Repo` (injectable):
  - `put<T extends SyncRecord>(table: TableName, rec: Omit<T, 'updatedAt'|'deviceId'> & Partial<SyncMeta>): Promise<T>` stamps `updatedAt = clock.now()` and `deviceId`.
  - `softDelete(table: TableName, id: ID): Promise<void>`.
  - `live<T>(query: () => Promise<T>): Signal<T | undefined>` is built on `liveQuery`.
  - `changes$: Observable<{ table: TableName; rec: SyncRecord }>` emits after every local `put` or `softDelete`.
  - `applyRemote(table, recs)` writes **without** stamping and **without** emitting `changes$`. The sync engine uses it.

- [ ] **Step 1: Tests.**
  - `put('books', {...})` → the stored record has `updatedAt === 1000` (clock overridden to 1000) and `deviceId === getDeviceId()`.
  - `softDelete` → the record still exists with `deleted: true` and an updated `updatedAt`.
  - Both emit on `changes$` exactly once.
  - `applyRemote` keeps the given `updatedAt` and emits nothing.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat: local database and repo`.

### Task 5: Shards and merge (pure)

**Files:** Create `sync/shards.ts`, `sync/merge.ts`. Test: `sync/merge.spec.ts`, `sync/shards.spec.ts`.

**Interfaces — Produces:**
- `shardFor(table: TableName, rec: SyncRecord): string`:

  | Table | File name |
  |---|---|
  | books, categories, upNext, goals, settings | `'library.json'` |
  | annotations, positions, readMarks | `` `book-${rec.bookId}.json` `` |
  | sessions | `` `sessions-${YYYY-MM of startedAt, UTC}.json` `` |
  | words | `'words.json'` |

- `interface ShardDoc { schemaVersion: 1; tables: Partial<Record<TableName, SyncRecord[]>> }` and `SCHEMA_VERSION = 1`.
- `wins(a: SyncMeta, b: SyncMeta): boolean`: `a.updatedAt > b.updatedAt`, or equal and `a.deviceId > b.deviceId`.
- `mergeTable(local: SyncRecord[], remote: SyncRecord[]): { toLocal: SyncRecord[]; needsPush: boolean; merged: SyncRecord[] }`:
  - `toLocal` holds remote records that win, or that are missing locally.
  - `needsPush` is true when any local record wins or is missing remotely.
  - `merged` is the winning set.
- `pruneTombstones(recs: SyncRecord[], now: number, maxAgeMs = 90 * 864e5): SyncRecord[]`.
- `duplicateBooks(books: Book[]): { keep: ID; drop: ID }[]`: among non-deleted books with the same `sha256`, keep the earliest `addedAt` (ties: lower `id`).

- [ ] **Step 1: Tests** (exact cases):
  1. Remote newer → appears in `toLocal`, `needsPush = false`.
  2. Local newer → not in `toLocal`, `needsPush = true`.
  3. Equal `updatedAt`, deviceIds `'b'` (local) vs `'a'` (remote) → local wins, `needsPush = true`.
  4. Remote tombstone newer than a live local → `toLocal` contains the tombstone.
  5. A record only local → `needsPush = true`. A record only remote → in `toLocal`.
  6. `pruneTombstones`: a tombstone with `updatedAt = now - 91 days` is removed; `now - 89 days` is kept; live records are always kept.
  7. `duplicateBooks`: two live books with the same sha256 and `addedAt` 5 and 3 → `[{keep: <addedAt 3>, drop: <addedAt 5>}]`. A deleted duplicate is ignored.
  8. `shardFor('sessions', {startedAt: Date.UTC(2026,10,30,23)})` → `'sessions-2026-11.json'`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat: shard mapping and merge`.

### Task 6: DriveAdapter interface and FakeDrive

**Files:** Create `sync/drive-adapter.ts`, `sync/fake-drive.ts`. Test: `sync/fake-drive.spec.ts`.

**Interfaces — Produces:**
```ts
export interface DriveFileInfo { id: string; name: string; modifiedTime: string; size?: number; appProperties?: Record<string, string>; }
export class DriveAuthError extends Error {}          // 401/403 from Drive
export interface DriveAdapter {
  listAppData(): Promise<DriveFileInfo[]>;
  readText(fileId: string): Promise<string>;
  writeAppDataJson(name: string, json: string, fileId?: string): Promise<DriveFileInfo>;
  writeAppDataBlob(name: string, blob: Blob, fileId?: string): Promise<DriveFileInfo>;
  ensureBooksFolder(): Promise<string>;                // creates Iqra/Books if missing; returns folder id
  uploadPdf(blob: Blob, name: string, folderId: string, bookId: string, onProgress?: (fraction: number) => void): Promise<DriveFileInfo>;
  downloadBlob(fileId: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<Blob>;
  deleteFile(fileId: string): Promise<void>;          // 404 counts as success
  storageQuota(): Promise<{ limit: number; usage: number }>;
  mediaRequest(fileId: string): { url: string; httpHeaders: Record<string, string> };
}
export const DRIVE_ADAPTER = new InjectionToken<DriveAdapter>('drive');
```
- `FakeDrive implements DriveAdapter`:
  - Keeps files in a `Map<string, { info: DriveFileInfo; data: Blob | string; space: 'appData' | 'drive' }>`.
  - `modifiedTime` is a strictly increasing ISO string, from a counter.
  - `exportState(): string` and `importState(json: string): void` (base64 for blobs) let e2e tests copy a "Drive" between browser contexts.
  - `failNext(error: Error)` makes the next call reject.

- [ ] **Step 1: Tests.**
  - `writeAppDataJson('a.json','{}')` then `listAppData()` → one file named `a.json`.
  - A second write with the same `fileId` → same id, larger `modifiedTime`.
  - `deleteFile` of an unknown id resolves.
  - `exportState`/`importState` round-trips a PDF blob byte-for-byte.
  - `failNext(new DriveAuthError())` → the next call rejects with `DriveAuthError`, and the call after that works.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat: drive adapter interface and fake`.

### Task 7: GoogleDrive adapter

**Files:** Create `sync/google-drive.ts`. Test: `sync/google-drive.spec.ts` (with a mocked `fetch`).

**Interfaces:**
- **Consumes:** `AuthService.token(): string | null` (Task 8). Write a `TokenSource` interface `{ token(): string | null }` here so this task doesn't depend on Task 8.
- **Produces:** `GoogleDrive implements DriveAdapter`, constructed with `(tokens: TokenSource, fetchFn = fetch)`.

**Endpoints** (base `https://www.googleapis.com`):

| Call | Request |
|---|---|
| list | `GET /drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime,size)&pageSize=1000` |
| read | `GET /drive/v3/files/{id}?alt=media` |
| create JSON or blob | `POST /upload/drive/v3/files?uploadType=multipart` with metadata `{name, parents:['appDataFolder']}` |
| update | `PATCH /upload/drive/v3/files/{id}?uploadType=media` |
| PDF upload | resumable: `POST /upload/drive/v3/files?uploadType=resumable` with metadata `{name, parents:[folderId], appProperties:{iqraBookId}}`, then `PUT` in 8 MiB chunks to the session URL, calling `onProgress` after each chunk. A network error retries the same chunk up to 4 times, with 1, 2, 4 and 8 s backoff, after asking for the committed range (`Content-Range: bytes */total`). |
| folder | find with `q=name='Iqra' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents`, then `Books` inside it. Create whichever is missing. |
| download | stream `response.body` and report `received / content-length` |
| quota | `GET /drive/v3/about?fields=storageQuota` |
| mediaRequest | `{ url: base + '/drive/v3/files/' + id + '?alt=media', httpHeaders: { Authorization: 'Bearer ' + token } }` |

- A 401 or 403 response → `throw new DriveAuthError()`.
- No token → `throw new DriveAuthError()` without calling `fetch`.

- [ ] **Step 1: Tests:**
  - `listAppData` sends the `Authorization: Bearer t1` header and maps `files`.
  - A 401 → rejects with `DriveAuthError`.
  - `uploadPdf` of a 20 MiB blob → 3 PUTs with `Content-Range` values `bytes 0-8388607/20971520`, `bytes 8388608-16777215/20971520` and `bytes 16777216-20971519/20971520`, and `onProgress` called with values that end at 1.
  - Transient retry: the 2nd PUT throws `TypeError` once → a range query, then a retry, then success.
  - `deleteFile` with a 404 resolves.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat: google drive adapter`.

### Task 8: AuthService and Welcome page

**Files:** Create `auth/auth.service.ts`, `auth/welcome.page.ts`, and `auth/fake-auth.service.ts` (for e2e). Test: `auth/auth.service.spec.ts` (with a stub of `google.accounts.oauth2`).

**Interfaces — Produces:**
```ts
export type AuthState = 'signed-out' | 'signed-in' | 'expired';
export interface Profile { name: string; email: string; picture?: string }
export abstract class AuthApi {               // DI token; GisAuthService or FakeAuthService
  abstract state: Signal<AuthState>;
  abstract profile: Signal<Profile | null>;
  abstract token(): string | null;            // null when expired or signed out
  abstract signIn(): Promise<void>;           // call only from a user gesture
  abstract reconnect(): Promise<void>;        // gesture; prompt ''
  abstract trySilent(): Promise<boolean>;     // no gesture; resolves false if a popup would be needed
  abstract signOut(): void;
  abstract markExpired(): void;               // the sync engine calls this on DriveAuthError
}
```
- **GisAuthService:**
  - Loads `https://accounts.google.com/gsi/client` once.
  - Uses `initTokenClient({ client_id, scope: SCOPES, callback })`.
  - Stores `expiresAt = now + expires_in*1000 - 60000`. `token()` returns `null` once that time has passed and sets the state to `expired`.
  - After the first sign-in, fetches the profile from `https://www.googleapis.com/oauth2/v3/userinfo`.
  - Persists `localStorage['iqra.profile']`. With a profile present, the state on load is `expired` (not `signed-out`), so the library shows offline.
- **Route guard:** `/welcome` when the state is `signed-out`; otherwise `/library`.
- **Welcome page:**
  - `COPY.welcome` title and body, and one primary button `COPY.welcome.cta`.
  - When `navigator.onLine` is false, the button is disabled and `COPY.welcome.offline` shows.
  - After sign-in, it runs, in order: `drive.ensureBooksFolder()`, `navigator.storage.persist()`, `sync.syncNow()`, then navigates to `/library`.

- [ ] **Step 1: Tests (with the GIS stub):**
  - After `signIn()` resolves with `expires_in: 3600`, `token()` returns the token.
  - Advancing the clock 3541 s makes `token()` return `null` and the state `expired`.
  - A stored profile at construction → the state is `expired`.
  - `signOut()` clears the profile and sets `signed-out`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Manual check:** `npx ng serve`, sign in with the real client ID, and confirm the `Iqra/Books` folder appears in Drive.
- [ ] **Step 6:** Commit with message `feat: google sign-in and welcome`.

### Task 9: Sync engine and status line

**Files:** Create `sync/sync-engine.ts`, `sync/sync-status.component.ts`. Test: `sync/sync-engine.spec.ts` (FakeDrive with two `IqraDb` instances named `iqra-a` and `iqra-b`, simulating two devices).

**Interfaces:**
- **Consumes:** `Repo` (Task 4), `DriveAdapter` (Task 6), `AuthApi` (Task 8), `shardFor`/`mergeTable`/`pruneTombstones`/`duplicateBooks` (Task 5).
- **Produces:**
  ```ts
  export type SyncStatus = 'synced' | 'saving' | 'offline' | 'paused' | 'error';
  export class SyncEngine {
    status: Signal<SyncStatus>; lastSyncedAt: Signal<number | null>; lastError: Signal<string | null>;
    start(): void;              // subscribes to repo.changes$ and registers the triggers
    syncNow(): Promise<void>;   // single-flight: concurrent calls share one run
    onAfterPull: ((dropped: { keep: ID; drop: ID }[]) => Promise<void>) | null;  // hook used for duplicate cleanup
  }
  ```

**Behavior** (spec §8):
- **Change tracking:** each `changes$` event marks `syncState[shardFor(...)].dirty = true`, sets the status to `saving`, and schedules `syncNow()` 5000 ms after the last change.
- **Triggers:** `start()` registers `visibilitychange` (when visible), `online`, and a 120000 ms interval.
- **Status rules:**
  - `navigator.onLine === false` → `offline`, and no network calls.
  - `auth.token()` is null → `paused`.
- **Pull:**
  1. `listAppData()`.
  2. For each file with a `modifiedTime` different from `syncState.remoteModified`, run `readText` and `JSON.parse`.
     - If parsing fails, or `schemaVersion > 1`: set `syncState.error`, skip the file and never write it. The final status is `error`, and `lastError` = `"library.json can't be read. It may have been made by a newer version of Iqra."` (with the actual file name).
  3. Otherwise `mergeTable` each table, `repo.applyRemote(toLocal)`, and store `remoteModified`.
  4. If `needsPush`, set `dirty`.
- **After the pull:** run `duplicateBooks(all books)`.
  - For each drop: soft-delete the dropped book.
  - Rewrite `bookId` from drop to keep on its annotations, positions, readMarks and sessions (using `repo.put`).
  - Add the dropped book's `driveFileId` and `coverFileId` to `pendingDriveDeletes` with `notBefore = now`.
- **Push:** for each dirty shard, re-read the remote file if its `modifiedTime` changed since the pull, merge, apply `pruneTombstones`, `writeAppDataJson`, then clear `dirty`.
- **Pending deletes:** process `pendingDriveDeletes` whose `notBefore ≤ now`.
- **Errors:** a `DriveAuthError` anywhere → `auth.markExpired()`, status `paused`, stop the run, and keep the dirty flags.
- **Success:** status `synced`, `lastSyncedAt = now`.
- `SyncStatusComponent` shows a dot and the matching `COPY.sync` text. When the status is `paused` it is a button that calls `auth.reconnect()` then `syncNow()`. When the status is `error`, the button calls `syncNow()`.

- [ ] **Step 1: Tests:**
  1. Device A puts a book and runs `syncNow` → `library.json` exists in FakeDrive. Device B runs `syncNow` → B has the book with the same `updatedAt`.
  2. A and B edit the same book's title (A at t=10, B at t=20) and both sync, in order A then B, then A again → both have B's title.
  3. **Review Focus 2:** `failNext(new DriveAuthError())` during the push → status `paused`, `markExpired` called, `syncState.dirty` still true. The next `syncNow` (after a token is restored) → `dirty` false and the remote has the record.
  4. **Review Focus 5:** `library.json` holds `"{not json"` → `syncNow` resolves, status `error`, `lastError` mentions `library.json`, the FakeDrive content is unchanged, and `book-x.json` still syncs.
  5. **Review Focus 3:** A and B each add a book with sha256 `h` (addedAt 1 and 2), both sync, A syncs again → A has exactly one live book (addedAt 1), and `pendingDriveDeletes` contains B's `driveFileId`.
  6. Offline (`navigator.onLine` stubbed to false) → status `offline` and zero adapter calls.
  7. Two concurrent `syncNow()` calls → `listAppData` is called once.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat: sync engine`.

### Task 10: Book import (hash, PDF metadata, cover)

**Files:** Create `books/import/hash.ts`, `pdf-meta.ts`, `cover.ts`, `import.service.ts`. Test: `books/import/pdf-meta.spec.ts`, `import.service.spec.ts`.

**Interfaces — Produces:**
- `sha256Hex(blob: Blob): Promise<string>` uses `crypto.subtle`.
- `cleanTitle(infoTitle: string | undefined, fileName: string): string`:
  - Use the info title if, after trimming, it is non-empty, isn't `untitled` (case-insensitive) and doesn't end in `.doc`, `.docx` or `.pdf`.
  - Strip a leading `Microsoft Word - `.
  - Otherwise use the file name without `.pdf`, with `_` and `-` replaced by spaces, and runs of spaces collapsed.
- `detectLanguage(text: string): 'en' | 'ar' | 'other'`: Arabic letters (`؀-ۿ`) at 30% or more of all letters → `ar`; Latin letters at 50% or more → `en`; otherwise `other`.
- `mapOutline(items: PdfOutlineItem[], resolvePage: (dest: unknown) => Promise<number | null>, parentPage = 1, prefix = ''): Promise<OutlineNode[]>`:
  - Keys are index paths (`"0"`, `"0.1"`).
  - An unresolvable destination takes `parentPage`.
  - `PdfOutlineItem = { title: string; dest: unknown; items: PdfOutlineItem[] }`.
- `readPdfMeta(blob: Blob): Promise<{ pageCount: number; title: string; author: string; outline: OutlineNode[]; language: Book['language'] }>`:
  - Uses `pdfjs-dist`.
  - Language is detected from the text of pages 1–5.
  - Throws `UnreadablePdfError` for password-protected files, invalid files or 0 pages.
- `renderCover(blob: Blob): Promise<Blob>`: page 1 at 240 px wide, `image/jpeg`, quality 0.8.
- `ImportService.importFiles(files: File[]): Promise<{ added: ID[]; skipped: string[] }>`. For each file, **in order, and continuing past failures:**
  1. Hash it. A live book with the same sha256 → toast `COPY.import.duplicate(name)`, then skip.
  2. `readPdfMeta`. On `UnreadablePdfError` → toast `COPY.import.unreadable(name)`, then skip.
  3. `renderCover`.
  4. `repo.put('books', …)` with:
     - `driveFileId: ''`, `status: 'to-read'`, `addedAt: now`, `lastPageReached: 0`.
     - `progressMode`/`pageMode` from the settings defaults (`'last-page'`/`'swipe'` if there are no settings).
     - `direction: language === 'ar' ? 'rtl' : 'ltr'`.
     - `categoryIds: []`, `tags: []`, `sizeBytes: file.size`.
  5. `db.pdfFiles.put` and `db.covers.put`.
  6. Two `pendingUploads` entries, kinds `pdf` and `cover`.

  At the end, toast `COPY.import.added(count)` if anything was added.

- [ ] **Step 1: Tests:**
  - `cleanTitle('Microsoft Word - Notes.docx','x.pdf')` → `'x'`.
  - `cleanTitle(' Thinking in Systems ','a.pdf')` → `'Thinking in Systems'`.
  - `cleanTitle('', 'clean_code-2nd ed.pdf')` → `'clean code 2nd ed'`.
  - `detectLanguage('مقدمة ابن خلدون في التاريخ')` → `'ar'`.
  - `detectLanguage('The origin of species')` → `'en'`.
  - `detectLanguage('12345 ...')` → `'other'`.
  - `mapOutline` on `[{title:'Ch1',dest:'d1',items:[{title:'1.1',dest:'bad',items:[]}]}]` with resolve `d1→5, bad→null` → `[{key:'0',title:'Ch1',page:5,children:[{key:'0.1',title:'1.1',page:5,children:[]}]}]`.
  - **Review Focus 4:** `importFiles([good.pdf, broken.pdf, good2.pdf])`, with `readPdfMeta` mocked to throw for broken → `added.length === 2`, and a toast with the exact `COPY.import.unreadable('broken.pdf')`.
  - Importing the same blob twice → the second is skipped with `COPY.import.duplicate`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. In `main.ts`, set `GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs'`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat: pdf import`.

### Task 11: Upload queue

**Files:** Create `books/upload-queue.ts`. Test: `books/upload-queue.spec.ts` (FakeDrive).

**Interfaces — Produces:**
- `UploadQueue.progress: Signal<Map<ID, number>>`: bookId → fraction, for PDFs only.
- `UploadQueue.run(): Promise<void>` processes `pendingUploads` one at a time:
  - `pdf` → `uploadPdf(blob, book.fileName, folderId, book.id, p => progress)`, then `repo.put('books', {...book, driveFileId})`.
  - `cover` → `writeAppDataBlob('cover-<id>.jpg', blob)`, then `repo.put` with `coverFileId`.
  - Delete the entry when it succeeds.
  - On failure, `attempts++` and stop the run. `DriveAuthError` → `auth.markExpired()`.
  - The run is called at the end of every successful `syncNow()`, and right after an import.
- Covers on other devices: when the library shows a book with a `coverFileId` and no `db.covers` entry, `CoverCache.get(book): Signal<string | null>` (object URL) downloads it once while online.

- [ ] **Step 1: Tests:**
  - After an import plus `run()`, the book's `driveFileId` is non-empty, and FakeDrive has a `drive`-space file with `appProperties.iqraBookId === book.id`.
  - A failure → the entry stays with `attempts === 1`, and the next `run()` succeeds.
  - `progress` reaches 1 and the entry is then removed.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat: upload queue and cover cache`.

### Task 12: Library query (pure)

**Files:** Create `books/library/library-query.ts`. Test: `library-query.spec.ts`.

**Interfaces — Produces:**
```ts
export type LibraryTab = 'reading' | 'to-read' | 'finished' | 'all';
export type SortKey = 'recent-read' | 'recent-added' | 'progress' | 'priority' | 'rating' | 'title';
export interface LibraryState { tab: LibraryTab; categoryIds: ID[]; tags: string[]; minRating: number | null; downloadedOnly: boolean; sort: SortKey; dir: 'asc' | 'desc'; query: string; }
export interface LibraryCtx { downloaded: Set<ID>; upNext: ID[]; markedCounts: Map<ID, number>; }
export const DEFAULT_LIBRARY_STATE: LibraryState; // tab 'reading', sort 'recent-read', dir 'desc', everything else empty or null/false
export function bookProgress(b: Book, markedCount: number): number;   // 0..1; last-page → lastPageReached/pageCount; marked → markedCount/pageCount
export function statusLine(b: Book, progress: number): string;
export function tabCounts(books: Book[]): Record<LibraryTab, number>;
export function queryLibrary(books: Book[], s: LibraryState, ctx: LibraryCtx): { upNext: Book[]; main: Book[]; paused: Book[] };
export function continueBook(books: Book[], s: LibraryState, ctx: LibraryCtx): Book | null;
export function activeFilterCount(s: LibraryState): number;
```

**Rules:**
- Deleted books are always excluded.
- **Tabs:**
  - `reading` holds status `reading` in `main`, plus status `paused` in `paused`.
  - `to-read` puts Up next books in `upNext` (in list order) and the other to-read books in `main`.
  - `finished` holds finished books.
  - `all` holds everything in `main`.
- **Filters combine with AND:**
  - Categories: a book matches if it has **any** of the selected categories.
  - Tags: the book must have **all** the selected tags.
  - Minimum rating: `rating >= min`. Unrated books are excluded once a minimum is set.
  - `downloadedOnly`.
  - `query`: case-insensitive match on title or author.
- **Sorts:**
  - `recent-read`: `lastOpenedAt` (falling back to `addedAt`).
  - `recent-added`: `addedAt`.
  - `progress`: `bookProgress`.
  - `priority`: Up next rank first, then the others by `recent-read`. Direction doesn't apply.
  - `rating`: rating, with unrated books always last.
  - `title`: `localeCompare` with `numeric: true`.

  `dir` reverses every sort except `priority`.
- **`statusLine`:**
  - finished → `'Finished'`.
  - to-read with `lastPageReached === 0` → `` `Not started · ${pageCount} pages` ``.
  - otherwise → `` `p. ${lastPageReached} of ${pageCount} · ${Math.round(progress*100)}%` ``.
- **`continueBook`:** the first book, in `recent-read` order among those passing the current filters, with status `reading` or `paused` and a defined `lastOpenedAt`. It ignores the tab.

- [ ] **Step 1: Tests** with a fixture of 6 books:
  - `tabCounts` is exact.
  - Categories match with OR: `[Tech, General]` returns books in either.
  - Tags match with AND.
  - `minRating: 7` excludes unrated books.
  - `priority` puts Up next books first, in list order.
  - `rating` desc and asc both keep unrated books last.
  - `statusLine` produces the 3 exact strings above.
  - `continueBook` with a category filter returns the most recent book in that category.
  - `activeFilterCount` counts categories, tags, minRating and downloadedOnly as 1 each when set.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat: library query`.

### Task 13: Library page

**Files:** Create `library.page.ts`, `book-card.component.ts`, `continue-card.component.ts`, `filter-sheet.component.ts`, `sort-menu.component.ts`. Test: `library.page.spec.ts` (component test with a seeded `IqraDb`).

**Interfaces:**
- **Consumes:** `queryLibrary`, `tabCounts`, `continueBook`, `statusLine`, `bookProgress` (Task 12); `SyncStatusComponent` (Task 9); `ImportService` (Task 10); `UploadQueue.progress` and `CoverCache` (Task 11); `FilesService` and `OpenBookSheet` (Task 15); `BookDetailsSheet` (Task 17).
- **Produces:** `LibraryPage` at `/library`. `LibraryState` persists in `localStorage['iqra.library']`; read and write it inside try/catch.

**Layout, top to bottom** (spacing per the prototype; the same visual language):
1. **Header:** `<f-sync-status>`, the H1 `COPY.library.title`, a search icon button (toggles a search field bound to `query`), a settings icon button (disabled until Plan 5; `aria-label="Settings"`), and a primary button with the upload icon and `COPY.library.add`, which opens a hidden `<input type=file accept="application/pdf" multiple>`.
2. **Status tabs:** a segmented control, `role="tablist"`, labels from `COPY.library.tabs` with the count in muted text (`Reading 5`).
3. **A row** with:
   - Active filter chips: category names, `#tag`, `★ ≥ 7`, `Downloaded only`. Each has a × (`aria-label="Remove filter <name>"`).
   - On the right, a `COPY.library.filter` button with a badge showing `activeFilterCount` when > 0.
   - A sort button showing the current `COPY.sort[key]` and an arrow (↓ desc, ↑ asc).
4. **The continue card** (if `continueBook` isn't null): cover, eyebrow `COPY.library.continue`, title (`dir=auto`), `statusLine`, the `COPY.library.resume` button and a progress bar.
5. **To read tab only:** an H2 `COPY.library.upNext` with the `upNext` list as compact rows (cover 40 px, title, and a drag handle `aria-label="Reorder"`). Dragging, or pressing Alt+↑/↓ on a focused row, reorders the list and saves `UpNext.bookIds` with `repo.put`.
6. **Grid** of book cards: 3 columns under 600 px, 4 under 900 px, 6 above. Each card shows:
   - The cover (object URL, or a generated placeholder: a teal block with the title in the book font).
   - The title, clamped to 2 lines.
   - `statusLine`.
   - A progress bar for reading or paused books.
   - A cloud badge (`aria-label="Not downloaded"`) when the book isn't downloaded.
   - A small ring with `UploadQueue.progress` while uploading.
7. **Reading tab only:** an H2 `COPY.library.paused` and its grid.
8. **Empty states:** with no books at all, `COPY.library.emptyAll` plus the Add PDF button. With books but none matching, `COPY.library.emptyFiltered` plus a `COPY.library.clearFilters` link.

**Filter sheet:**
- Category chips (multi-select).
- Tag chips (multi-select, from the union of book tags).
- A minimum rating chip row: Any, 5+, 6+, 7+, 8+, 9+.
- A Downloaded only switch.
- Footer: `COPY.filter.reset` and `COPY.filter.apply`.

**Sort menu:** a sheet listing the 6 keys. Picking the current key flips `dir`.

**Interactions:**
- Card tap → `FilesService.openBook(book)` (Task 15).
- Long-press (480 ms, cancelled by moving more than 8 px) or right-click (`contextmenu`) → `BookDetailsSheet`.
- Drag-and-drop of PDFs anywhere on the page → `importFiles`.

- [ ] **Step 1: Tests:**
  - Seed 3 books (reading, paused, to-read) → the Reading tab shows 1 card in the main grid and 1 under Paused, and the tab label reads `Reading 2`.
  - Applying the category filter via the sheet shows the chip, and removing the chip restores the list.
  - The empty-filter state text equals `COPY.library.emptyFiltered`.
  - A not-downloaded book shows the element `[aria-label="Not downloaded"]`.
  - Right-clicking a card opens the details sheet.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run `npx ng serve`, add 3 PDFs, and look at the layout at 400 px and 1280 px wide.
- [ ] **Step 5:** Commit with message `feat: library page`.

### Task 14: Reader stub

**Files:** Create `reader/reader-stub.page.ts`. Test: none (covered by the e2e test in Task 18).

- [ ] **Step 1:** At `/read/:bookId` (query `?source=drive` for streaming):
  - Load with `pdfjs.getDocument({ data })` from `db.pdfFiles`, or `getDocument({ url, httpHeaders, rangeChunkSize: 65536, disableAutoFetch: true })` from `drive.mediaRequest(book.driveFileId)` when streaming.
  - Render page 1 to a canvas fitted to the width.
  - Show a back button and the text `Page 1 of N`.
  - Set `book.lastOpenedAt = now` (`repo.put`) and, if the status is `to-read`, set it to `reading`.

  Plan 2 replaces this page.
- [ ] **Step 2:** Manual check: open a downloaded book and a streamed one. Both render.
- [ ] **Step 3:** Commit with message `feat: reader stub`.

### Task 15: Files service and the open and remove sheets

**Files:** Create `books/files.service.ts`, `books/open-book.sheet.ts`, `books/remove-book.sheet.ts`. Test: `books/files.service.spec.ts`.

**Interfaces — Produces:**
```ts
export class FilesService {
  downloaded: Signal<Set<ID>>;                       // live from db.pdfFiles
  downloadProgress: Signal<Map<ID, number>>;
  openBook(b: Book): void;                           // downloaded → router '/read/:id'; else opens OpenBookSheet
  download(b: Book): Promise<void>;                  // stores in db.pdfFiles; toast COPY.open.failed on error
  stream(b: Book): void;                             // router '/read/:id?source=drive'
  removeLocal(b: Book): Promise<void>;               // deletes db.pdfFiles entry; toast COPY.remove.removedDevice
  deleteEverywhere(b: Book): Promise<void>;          // see below
}
```

**Behavior:**
- **Open sheet:** title `COPY.open.title`, then two large option buttons, each with an icon, a label and a hint:
  - Stream: `COPY.open.stream` / `COPY.open.streamHint`.
  - Download: `COPY.open.download` / `COPY.open.downloadHint(size in MB, 1 decimal)`.

  While downloading, the download option shows `COPY.open.downloading(p)` and a progress bar, then the book opens automatically. Offline: both options are disabled and `COPY.open.offline` shows.
- **Review Focus 1:** `openBook` on a book with `driveFileId === ''` that isn't downloaded → toast `COPY.library.uploadingElsewhere` and nothing else happens. The card shows that same text in place of `statusLine`.
- **Remove sheet:** title `COPY.remove.title`, with:
  - Option A `COPY.remove.device` / `deviceHint` (only shown when the book is downloaded).
  - Option B `COPY.remove.everywhere` / `everywhereHint`, styled in the danger color.
- **`deleteEverywhere`:**
  1. Soft-delete the book and every annotation, position and readMark with that `bookId`. Remove it from `UpNext`.
  2. Add `pendingDriveDeletes` entries for `driveFileId`, `coverFileId` and the shard `book-<id>.json` (resolved from `syncState.remoteId`), with `notBefore = now + 10000`.
  3. Show the toast `COPY.remove.deleted(title)` for 10000 ms with Undo. Undo restores every soft-deleted record (`repo.put` with `deleted: false`) and removes the pending deletes.
  4. Remove the local PDF only after the toast expires.

- [ ] **Step 1: Tests:**
  - `openBook` on a downloaded book navigates to `/read/<id>`.
  - On a not-downloaded book, the sheet opens.
  - With `driveFileId === ''`, the toast text is `COPY.library.uploadingElsewhere`.
  - `deleteEverywhere` then undo within 10 s → the book and its annotations are live again, and `pendingDriveDeletes` is empty.
  - Without undo, after 10 s and a `syncNow` → the FakeDrive file is gone.
  - `download` with FakeDrive `failNext(new TypeError())` → toast `COPY.open.failed`, and nothing is stored.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat: open, download, stream, remove`.

### Task 16: Categories and Up next data helpers

**Files:** Create `books/catalog.service.ts`. Test: `catalog.service.spec.ts`.

**Interfaces — Produces:**
```ts
export class CatalogService {
  categories: Signal<Category[]>;                    // live, non-deleted, by order
  upNext: Signal<ID[]>;                              // live UpNext.bookIds (missing record → [])
  addCategory(name: string): Promise<Category>;      // trims; returns the existing one if the name matches case-insensitively
  setUpNext(ids: ID[]): Promise<void>;
  toggleUpNext(bookId: ID, on: boolean): Promise<void>;  // on → append at end
}
```
- [ ] **Step 1: Tests:**
  - `addCategory(' Tech ')` twice → one category named `Tech`.
  - `toggleUpNext(a,true)`, `toggleUpNext(b,true)`, `toggleUpNext(a,false)` → `['b']`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat: categories and up next`.

### Task 17: Book details sheet (Details tab)

**Files:** Create `books/details/book-details.sheet.ts`. Test: `book-details.sheet.spec.ts`.

**Interfaces:** consumes `CatalogService` (Task 16), `FilesService` (Task 15) and `Repo`. Produces `BookDetailsSheet.open(bookId: ID)`.

**Layout:** a tall sheet with two segmented tabs, `COPY.details.tabDetails` and `COPY.details.tabStats`. The Stats tab shows only `COPY.details.statsSoon` for now. Details tab fields, in order:
1. Title and author: inputs with `dir="auto"`.
2. Status: a 4-option segmented control using `COPY.status`.
3. Categories: chips (multi-select), plus a last chip `+ ` + `COPY.details.newCategory` that turns into an inline input (Enter → `addCategory`, then select it).
4. Tags: chips with ×, and an input `COPY.details.tagPlaceholder`. Tags are normalized to lowercase-kebab with no `#`.
5. Rating: 10 small round buttons numbered 1–10, with `aria-pressed` on the chosen one. Tapping the chosen one again clears it. Next to them, the text `7/10`, or `—`.
6. Review: a textarea with `COPY.details.reviewPlaceholder`.
7. In Up next: a switch.
8. Track progress by: segmented `COPY.details.lastPage` / `marked`. Turn pages by: segmented `swipe` / `scroll`.
9. File card: `PDF · 18.4 MB · 502 pages`, plus `COPY.details.onDevice` or `notDownloaded`, and the button `download` or `removeDownload`.

**Footer:** a danger ghost button `COPY.details.remove` (opens the remove sheet), then Cancel and Save. Save writes one `repo.put('books', …)`, updates Up next, closes the sheet and toasts `COPY.details.saved`. Cancel discards the edits.

- [ ] **Step 1: Tests:**
  - Change the title to `'كليلة ودمنة'` and Save → the stored title matches, and the title input has `dir="auto"`.
  - Tap rating 8, then 8 again → `rating` is undefined after Save.
  - The tag input `"Big Question"` + Enter → tag `big-question`.
  - Cancel → the store is unchanged.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit with message `feat: book details sheet`.

### Task 18: End-to-end test across two devices

**Files:** Create `e2e/fixtures/make-fixtures.mjs`, `e2e/library.spec.ts`, `playwright.config.ts`.

- [ ] **Step 1: Fixtures.** `make-fixtures.mjs` uses pdf-lib to write:
  - `sample.pdf`: 5 pages with "Page N" text, Title `Sample Book`, Author `Test Author`.
  - `broken.pdf`: the bytes `not a pdf`.

  Run `node e2e/fixtures/make-fixtures.mjs`.
- [ ] **Step 2: Configuration.** `playwright.config.ts` serves the e2e configuration with `webServer: { command: 'npx ng serve --configuration e2e --port 4300', port: 4300 }`. The e2e configuration uses `FakeAuthService` (always signed in, profile `Test User`) and `FakeDrive`. The fake exposes `window.__iqraDrive` with `exportState()` and `importState()`.
- [ ] **Step 3: Test "library syncs between devices":**
  1. Context A: set the files `sample.pdf` and `broken.pdf` on the Add PDF input → expect a toast containing `broken.pdf couldn't be added`. Switch to the "To read" tab → expect a card with the text `Sample Book`.
  2. Trigger sync with `page.evaluate(() => window.__iqraSync.syncNow())`.
  3. Copy the Drive: B's `importState(A's exportState())`.
  4. Context B: load `/library`, run `syncNow()` → under "To read", `Sample Book` has `[aria-label="Not downloaded"]`. Tap it → the sheet shows `Read from Google Drive`. Tap `Download to this device` → the URL matches `/read/` and the text `Page 1 of 5` is visible.
- [ ] **Step 4: Test "delete everywhere with undo":** open details, Remove book, Delete everywhere, Undo → the card is still there.
- [ ] **Step 5:** Run `npx playwright test --trace off`. Expected: 2 passed.
- [ ] **Step 6:** Commit with message `test: e2e library sync`.

### Task 19: Deploy to GitHub Pages

**Files:** Create `.github/workflows/deploy.yml`.

- [ ] **Step 1:** The workflow runs on push to `main`. It installs with `npm ci`, runs `npx ng test --watch=false`, builds with `npx ng build --configuration production --base-href /<repo>/`, copies `index.html` to `404.html`, and deploys with `actions/upload-pages-artifact` and `actions/deploy-pages`.
- [ ] **Step 2:** The owner pushes the repository to GitHub, enables Pages (source: GitHub Actions), and confirms the site loads at `https://<user>.github.io/<repo>/`. The OAuth origin from Task 0 must match.
- [ ] **Step 3: Manual acceptance on the owner's devices.**
  - Install the app on the Android phone (Chrome menu → Install app) and on the Windows PC.
  - Sign in on both.
  - Add a PDF on the PC → it appears on the phone within 2 minutes, or right away after reopening the app.
  - Stream it on the phone.
  - Turn on airplane mode → the library still loads, and the status reads `Offline · changes are saved on this device`.
- [ ] **Step 4:** Commit with message `ci: deploy to github pages`.

---

## Self-review notes
- **Spec coverage for this plan's scope:**
  - §5 → Tasks 1, 2.
  - §6 → Tasks 0, 7, 8.
  - §7 → Task 3.
  - §8 → Tasks 4, 5, 9.
  - §9.1 → Tasks 10, 11, 15.
  - §9.7 → Tasks 12, 13, 16.
  - §9.8 Details tab → Task 17.
  - §10 → Task 2.
  - Spike 3 (sign-in on the installed Android PWA) → Task 19, Step 3. Spike 5 (resumable transfers) → Task 7. Spike 6 (streaming) → Task 14.
  - Spikes 1, 2 and 4 belong to Plan 2. Spike 7 belongs to Plan 5.
- **Deferred:** Settings (Plan 5); the reader, positions and history (Plan 2); annotations (Plan 3); sessions and stats (Plan 4).
