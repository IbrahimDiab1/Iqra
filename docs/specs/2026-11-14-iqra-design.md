# Iqra — Design Document

Status: draft for approval · Date: 2026-11-14 · Owner: Ibrahim
Visual reference: `iqra/folio-prototype.html` (published as the "Folio Reader Prototype" artifact, made before the rename). Section 13 lists where this document overrides the prototype.

Marks used below:
- **[decided]** — the owner decided this in conversation.
- **[my call]** — a sensible default chosen during design. The owner can change it.

---

## 1. Intent

Iqra is a personal PDF reader for one person. It runs as an installable web app (PWA) on Android (Chrome) and Windows (Chrome/Edge). The owner uploads a PDF once and can then read it on any device. Reading position, highlights, notes, summaries and progress follow them between devices.

**Why:** BookFusion does this well but costs too much. Iqra should be free to run forever, using storage the owner already has (Google Drive), and feel better to use day to day. **[decided]**

**What success looks like:**
- Opening a book takes one tap and lands on the exact place the owner left off, even if they left off on the other device.
- Highlighting is a single action. Reading a note is a tap on the highlighted text.
- The owner can answer "what did I read this week, and against which goals" at a glance.
- Running cost is zero.

## 2. Goals, non-goals, anti-goals

**Goals (phase 1)**
- Library with metadata synced everywhere. The PDF files themselves download only when needed.
- A PDF reader with:
  - Page view and reading mode.
  - Swipe mode and continuous-scroll mode.
  - Zoom.
  - Back and forward through jumps.
  - Highlights, notes, side notes, bookmarks and summaries.
  - Search inside the book.
- Notes hub: search and filter every annotation across all books.
- Progress per book (last page reached, or pages marked as read), progress per chapter, and weekly goals.
- Per-book stats with a daily reading chart.
- Settings, storage overview and download management.
- Works fully offline for downloaded books, and syncs in the background.

**Phase 2:** Language Notebook (translate a selection to Arabic, save it, flashcard review in both directions). Metadata lookup.
**Phase 3:** On-demand OCR for pages without selectable text. Text-to-speech.

**Non-goals**
- Multi-user support, sharing or social features.
- Formats other than PDF.
- A backend server of any kind.
- Native app-store apps.
- Editing the PDF file itself. Annotations live beside the file, never inside it.
- Manually defining chapters for PDFs that have no built-in bookmarks. **[decided]** Such books simply have an empty Contents. Page-range summaries cover that need.

**Anti-goals** (the app fails if any of these happen, even when it technically works)
- Any recurring cost, or anything that needs a paid service.
- Reading is blocked by the network, by sign-in or by sync. Reading must always work for downloaded books.
- Any annotation is lost because two devices edited at different times.
- Clutter on the reading screen. Tools appear on demand, and the page stays the focus.
- Confirmation dialogs for undoable actions. Use an undo toast instead.

## 3. Constraints

- **Cost:** $0. Static hosting, the free Google APIs, no paid tiers. **[decided]**
- **Platforms:** Android Chrome and Windows Chrome/Edge. iOS is not a target. **[decided]**
- **Stack:** Angular and TypeScript. No Spring, no server. **[decided]**
- **Storage:** the owner's Google Drive. Books are uploaded through the app. **[decided]**
- **Implementation by Claude Haiku:** the specs written after this document must decide every visual and behavioral detail. Haiku should never have to invent design.

## 4. Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Serverless Angular PWA.** Local database in the browser, Google Drive as the only cloud storage, files and sync data accessed straight from the browser. | $0 to run, offline-first, nothing to maintain. In exchange, the app has to merge changes from two devices itself, and the Google login token lasts about an hour. | **Chosen** |
| B. Angular plus a Spring Boot API and Postgres for the reading data, with Drive only for files. | Sync is simpler, but it needs hosting. Free hosting tiers sleep or expire, so it either costs money or works badly. | Rejected: breaks the $0 goal |
| C. Native app (Capacitor) plus a web app. | Better access to device features. Adds a store build and two code paths, with little gain for a reader app. | Rejected: a PWA covers the need |

## 5. Architecture

```
┌──────────────────────── Browser (PWA) ─────────────────────────┐
│ Angular UI (standalone components, signals)                     │
│   ├─ Library · Reader · Notes · Stats · Settings (· Words, P2)  │
│ Domain services: books, annotations, progress, sessions, goals  │
│ Local DB: IndexedDB via Dexie   ← single source of truth for UI │
│ PDF engine: pdf.js (web worker)                                 │
│ Sync engine ── Drive adapter ── Auth (Google Identity Services) │
│ Service worker: app shell offline cache                         │
└───────────────┬──────────────────────────────────────────────────┘
                │ HTTPS (only when signed in and online)
        ┌───────▼────────────────────────────────────────┐
        │ Google Drive (owner's account)                  │
        │  My Drive/Iqra/Books/*.pdf     (visible)       │
        │  appDataFolder/*.json, covers   (hidden)        │
        └─────────────────────────────────────────────────┘
```

**Libraries:**
- Current stable Angular.
- `@angular/service-worker`.
- `pdfjs-dist`.
- `dexie`.
- Google Identity Services, loaded from Google's own script.
- Drive REST v3, called with `fetch`. No Google client library.

Charts are hand-built SVG, with no chart library. **[my call]** Exact versions get pinned in the implementation plan.

**Hosting:** GitHub Pages. **[my call]** The site URL is registered as an authorized JavaScript origin on the Google OAuth client.

**The core rule:** the UI only ever reads from and writes to the local database. Sync moves data between the local database and Drive in the background. Nothing in the UI waits for the network, except downloading a PDF the device doesn't have yet.

## 6. Google sign-in and Drive

### 6.1 Sign-in
- Sign-in uses Google Identity Services with the token flow, so it works without a server.
- **Scopes:**
  - `openid email profile`.
  - `https://www.googleapis.com/auth/drive.file`: only files the app created.
  - `https://www.googleapis.com/auth/drive.appdata`: the hidden app folder.

  Neither Drive scope is a "restricted" scope. Google's sensitivity class for each must be confirmed when the OAuth consent screen is set up.
- **The access token lasts about an hour and is kept only in memory.** When it expires:
  - Reading carries on normally.
  - The status line shows "Sync paused · Tap to reconnect".
  - Tapping it calls `requestAccessToken({ prompt: '' })`. The call happens inside the tap because browsers block sign-in popups that don't follow a user tap.
  - The app also tries one silent renewal whenever it is opened or comes back to the foreground.
- **First launch:**
  1. Welcome screen with one action, "Continue with Google".
  2. The Google consent screen.
  3. The app creates `Iqra/Books` in Drive if it's missing.
  4. It does a first full sync and shows the library.
- **Offline first launch** (not signed in, no network): the welcome screen explains that a connection is needed once.

### 6.2 Drive layout

| Where | What | Notes |
|---|---|---|
| `My Drive/Iqra/Books/` | The PDF files, original file names | Visible to the owner in Drive. Each file carries `appProperties.iqraBookId`. |
| `appDataFolder/library.json` | Books, categories, goals, settings, the Up next list | Small. |
| `appDataFolder/book-<bookId>.json` | That book's annotations, positions and read-page marks | One file per book keeps each sync upload small. |
| `appDataFolder/sessions-<YYYY-MM>.json` | Reading sessions for that month | Grows slowly. |
| `appDataFolder/words.json` | Language Notebook entries (phase 2) | |
| `appDataFolder/cover-<bookId>.jpg` | A ~240px-wide JPEG of page 1 | Lets the library show covers without downloading the PDF. |

**Uploads** use Drive's resumable upload for any file over 5 MB, and show progress.

## 7. Data model

These are TypeScript interfaces. Every **synced** record carries `SyncMeta`.

```ts
type ID = string;                  // crypto.randomUUID()
interface SyncMeta {
  id: ID;
  updatedAt: number;               // ms, device clock, set on every local write
  deviceId: string;                // stable per install, stored locally
  deleted?: boolean;               // deletion marker; never hard-delete synced records
}

interface Book extends SyncMeta {
  title: string; author: string;
  driveFileId: string; fileName: string; sizeBytes: number; sha256: string;
  pageCount: number;
  outline: OutlineNode[];          // captured once at upload; [] if the PDF has none
  coverFileId?: string;
  language: 'en' | 'ar' | 'other'; // detected at upload from page text; editable
  direction: 'ltr' | 'rtl';        // swipe direction; defaults from language
  addedAt: number;
  lastOpenedAt?: number;
  status: 'to-read' | 'reading' | 'paused' | 'finished';
  startedAt?: number;              // first day with ≥3 pages read (set automatically)
  finishedAt?: number;             // set when status becomes 'finished'
  categoryIds: ID[];               // a book can be in several categories
  tags: string[];                  // free labels, lowercase-kebab
  rating?: number;                 // integer 1–10
  review?: string;
  progressMode: 'last-page' | 'marked';   // per book [decided]
  pageMode: 'swipe' | 'scroll';            // per book
  lastPageReached: number;         // furthest page opened (for last-page mode)
}
interface OutlineNode { key: string; title: string; page: number; children: OutlineNode[]; }
// key = index path, e.g. "3.1". Chapter page range = [node.page, nextNodeAtSameOrHigherLevel.page - 1], or to the book's end.

interface Position extends SyncMeta {     // id = `${bookId}:${deviceId}` (one per device)
  bookId: ID; page: number; offset: number;  // offset 0..1 within the page
  zoom: number; view: 'page' | 'reflow';
}

interface ReadMark extends SyncMeta {     // id = `${bookId}:${page}`
  bookId: ID; page: number; read: boolean;
}

type Rect = { x: number; y: number; w: number; h: number };  // 0..1, relative to the page at scale 1
interface TextAnchor {
  page: number;
  start: { item: number; offset: number };  // pdf.js text-content item index + char offset
  end:   { item: number; offset: number };
  rects: Rect[];                            // computed once at creation; used for drawing
  quote: string;                            // the selected text, for lists, search and export
}
type SummaryScope =
  | { kind: 'book' }
  | { kind: 'outline'; nodeKey: string; title: string; fromPage: number; toPage: number }
  | { kind: 'pages'; fromPage: number; toPage: number };

interface Annotation extends SyncMeta {
  bookId: ID;
  type: 'highlight' | 'note' | 'area' | 'side-note' | 'summary' | 'bookmark';
  // highlight: colored text.  note: underlined text with a note, no color.
  // area: a rectangle on a page.  side-note: attached to a page, never drawn.
  page?: number;                 // all except summary
  color?: 'yellow' | 'green' | 'blue' | 'pink';   // highlight, area
  text?: TextAnchor;             // highlight, note
  rect?: Rect;                   // area
  scope?: SummaryScope;          // summary
  body?: string;                 // note text / summary text
  tags: string[];
  createdAt: number;
}

interface Category extends SyncMeta { name: string; order: number; }
interface UpNext extends SyncMeta { id: 'up-next'; bookIds: ID[]; }   // ranked read-next list [decided]
interface Goal extends SyncMeta {
  categoryId: ID | null;         // null = all books
  measure: 'time' | 'pages'; target: number;   // minutes or pages, per week
}
interface Settings extends SyncMeta {
  id: 'settings';
  defaultProgressMode: Book['progressMode']; defaultPageMode: Book['pageMode'];
  defaultView: 'page' | 'reflow'; readerTheme: 'paper' | 'sepia' | 'night';
  weekStartsOn: 0 | 1 | 6;       // Sun / Mon / Sat; default 6 = Saturday [decided]
  reminders: ReminderSettings;
  cardDirection: 'en-ar' | 'ar-en' | 'mixed';   // phase 2
}

interface ReadingSession extends SyncMeta {   // written by exactly one device, never edited
  bookId: ID; startedAt: number; endedAt: number;
  activeMs: number;                // excludes idle time
  pagesRead: number[];             // pages that counted as read in this session (see 9.2)
}

interface Word extends SyncMeta {   // phase 2
  text: string; translation: string; bookId: ID; page: number;
  srs: { due: number; intervalDays: number; ease: number; reps: number; lapses: number };
}
```

**Stored only on the device (never synced):**
- PDF files (`pdfFiles` table: bookId → Blob).
- Rendered page cache.
- Sync state (last-pulled time and dirty flag for each Drive file).
- The jump history (back/forward).
- `deviceId`.
- The access token, held in memory only.

## 8. Sync

**Unit of sync:** a record. Each Drive JSON file holds `{ schemaVersion: 1, records: Record[] }` for its group of records.

**Merging (applies to every record type):**
1. Records are matched by `id`. The one with the higher `updatedAt` wins.
2. On a tie, the higher `deviceId` wins, compared as strings.
3. Deletion markers are records like any other, so deletions sync too. Markers older than 90 days are dropped from files during sync. **[my call]**

**When sync runs:**
- When the app starts.
- When it returns to the foreground (`visibilitychange`).
- When the network comes back (`online` event).
- 5 seconds after the last local change (debounced).
- Every 2 minutes while the app is open.

Only one sync runs at a time.

**One sync pass:**
1. **Pull.** List `appDataFolder` files with their `modifiedTime`. Download any file that changed since the last pull, merge its records into the local database, and record the pull time.
2. **Self-heal.** If a local record is newer than its copy in the just-pulled file, mark that Drive file dirty.
3. **Push.** For each dirty Drive file, re-download it if it changed again, merge, then upload the merged result.
4. **Upload pending PDFs and covers** (books added while offline).

Push always merges before uploading. If two devices push at nearly the same moment, the next pass fixes it, because of step 2. Annotations therefore cannot be lost.

**Status line states:**
- "Synced with Google Drive"
- "Saved on this device · syncing"
- "Offline · changes are saved on this device"
- "Sync paused · Tap to reconnect"
- "Sync failed · Tap to retry" (the reason appears in Settings)

**Storage persistence:** call `navigator.storage.persist()` after first sign-in, so the browser doesn't evict local data.

## 9. Core behaviors

### 9.1 Adding books and downloads
- **Add PDF** opens the file picker. Several files can be picked at once.
- **For each file:**
  1. Compute its SHA-256. If an existing book has the same hash, show "Already in your library" and skip it.
  2. Read page count, outline, title and author (PDF info, falling back to the file name), and language (from the text of the first pages).
  3. Render page 1 as the cover.
  4. Save the file locally. It counts as downloaded.
  5. Queue the upload, which shows per-file progress.
- **Downloads happen only when the owner asks.** **[decided]**
  - Metadata, covers and annotations always sync to every device. The PDF does not.
  - In the library, a book that isn't on the device shows a small cloud badge.
  - **Opening a book that isn't downloaded never downloads it automatically.** A small sheet asks:
    - **"Read from Google Drive":** the book streams into the reader, which fetches only the pages being read. Nothing is saved on the device. All reader features work, and notes and progress save locally as usual. Needs a connection.
    - **"Download to this device":** saves the whole file with a progress ring on the cover, then opens it. It stays available offline.
    - If the device is offline, both options are disabled and the sheet says: "This book isn't on this device. Connect to the internet to read it from Drive or download it."
  - Book details also has "Download" and "Remove download".
- **Removing a book** opens a sheet with two choices: **[decided]**
  - **"Remove from this device":** deletes only the local PDF file. The book, its notes and the Drive file stay. This option is only shown if the book is downloaded.
  - **"Delete everywhere":** removes the book from the library on all devices, deletes its notes and progress, and deletes the PDF from Google Drive. An undo toast is shown for 10 seconds, and the Drive file is only deleted after the toast expires. Deletion markers carry the removal to the other devices.
- **Manage downloads** (in Settings) lists downloaded books by size, grouped by status. Selecting books and tapping "Remove N downloads (X MB)" frees the space. The files stay in Drive.

### 9.2 Reading time, pages read and sessions [decided]
- A session starts when a book becomes visible on screen.
- Activity means a page turn, scroll, tap, zoom or selection. **After 2 minutes with no activity, the clock pauses**, and the next activity resumes it.
- The session ends when the reader closes, the app goes to the background, or 30 minutes pass idle. **[my call]**
- **Counting pages read:** a page counts as read in a session when it was the current page for at least 5 seconds of active time. **[my call]** In continuous scroll, the current page is the one covering the most of the screen. The same page counts at most once per day for stats.
- **Started:** the first day the book has at least 3 pages read. `startedAt` is set to that day, and the status changes to `reading` if it was `to-read`.
- **Finished:** when the owner reaches the last page in last-page mode, or all pages are marked in marked mode, a toast offers "Mark as finished?". `finishedAt` is set when the status becomes `finished`.
- **Average time per page** for a book = total active time ÷ total pages read.

### 9.3 Progress
- **Last-page mode:** progress = `lastPageReached / pageCount`.
- **Marked mode:** progress = marked pages ÷ `pageCount`.
  - Marking a chapter or section marks every page in its range, and unmarking clears them.
  - The reader's bottom bar shows a "Mark read" toggle for the current page.
- **Chapter progress** uses the same mode as the book:
  - In last-page mode, a chapter is done when `lastPageReached ≥ its last page`; otherwise its progress is the share of its range up to `lastPageReached`.
  - In marked mode, it's the share of its pages that are marked.
- Contents shows a small bar for each chapter and section, plus "N of M chapters done", where chapters are the top level of the outline.
- The owner can switch a book's mode at any time from book details or reading settings. Existing marks and `lastPageReached` are both kept.

### 9.4 Opening a book [decided]
- The app finds the book's `Position` records and picks the newest one across all devices.
- It opens at exactly that page, offset, zoom and view.
- If the newest position came from another device and differs from this device's last position, a toast says "Synced from your other device · Back to p. 98". The Back action returns to this device's last position.

### 9.5 Reader
- **View:**
  - **Page** (default): the PDF page as rendered.
  - **Reading mode:** the page's text reflowed into paragraphs at a comfortable size, using the reader theme. Pages with no text show "This page has no selectable text" plus a "Show page" button.

  Toggled from the top bar, and remembered in `Position.view`.
- **Page mode** (per book):
  - **Swipe:** one page at a time, with horizontal swipe, arrow keys and edge buttons. For right-to-left books, swiping is mirrored: swipe right for the next page.
  - **Scroll:** continuous vertical scrolling, rendering only the visible pages plus one on each side.
- **Zoom:**
  - Pinch on touch. Ctrl+wheel or the + and − buttons on PC.
  - Double-tap toggles between fit-to-width and the last custom zoom.
  - Range 50–400% in page view. In reading mode, zoom changes text size, 80–200%.
- **Back and forward through jumps** [decided]:
  - Any jump from Contents, search, the notes list, bookmarks or the page slider pushes the current position onto a back stack.
  - Back and Forward buttons in the top bar, plus Alt+← and Alt+→, move through it.
  - Turning a page normally doesn't create a history entry.
  - History is per book and per session, and stays on the device.
- **Controls:** tapping the page outside any text hides or shows the top and bottom bars. Esc closes any open popup or sheet.
- **Selecting text:**
  - On touch: long-press, then drag. Native-style handles let you adjust the start and end.
  - With a mouse: click and drag.
  - Tapping a single word selects it.
  - The selection toolbar shows 4 colors, Note, Tag, Arabic (phase 2) and Copy.
  - Picking a color saves the highlight immediately and shows an undo toast.
  - A new highlight that overlaps existing ones merges with them, keeping all their notes and tags.
- **Tapping highlighted text** opens the note popup: quote, note, tags, color dots, Delete, Edit. A small dot after a highlight's last character marks highlights that have a note or tags.
- **Area highlight:** a top-bar tool, page view only. Drag a rectangle, then pick a color or Note.
- **Search in book:** uses pdf.js text search across all pages. Results show the page and a short snippet. Tapping a result jumps there (adding a history entry) and briefly flashes the match.

### 9.6 Highlight anchoring
- **On creation,** the selection from the pdf.js text layer is saved as a `TextAnchor`:
  - Start and end positions in the page's text.
  - The normalized rectangles of the selection.
  - The quote.
- **In page view,** drawing uses `rects`, scaled to the current zoom, so it never depends on the text layer being ready.
- **In reading mode,** the reflowed text is built from the same text items, so the anchor's positions map straight onto the reflowed text.

### 9.7 Library
- **Header:** sync status line, title "Library", then Search, Settings and "Add PDF".
- **Status tabs:** Reading · To read · Finished · All, each with its count. Paused books appear under the Reading tab, in a "Paused" group at the end. **[my call]**
- **Below the tabs:**
  - Active filter chips, each with a ×.
  - A **Filter** button: a sheet with categories (multi-select, a book matches if it's in any of them), tags (multi-select), minimum rating, and "Downloaded only". Filter groups combine with AND.
  - A **Sort** button: Recently read (default), Recently added, Progress, Priority, Rating, Title. Tapping the active option again flips its direction.
- **Priority = the Up next list:** **[decided]**
  - The To read tab shows "Up next" at the top as a ranked list with drag handles, followed by the other to-read books.
  - "Add to Up next" and "Remove from Up next" are in book details.
  - Sorting by Priority puts Up next books first, in their rank order.
- **"Continue reading" card:** the most recently opened book that matches the current tab and filters and has status reading or paused. It is hidden if there isn't one.
- **Grid:** 3 columns on phones, more on wider screens. Each book shows its cover, title, a status line ("p. 118 of 304 · 39%", "Not started · 96 pages", "Finished") and a progress bar. Not-downloaded books show the cloud badge.
- **Long-press, or right-click on PC,** opens book details.

### 9.8 Book details and book stats
Book details is a sheet with two tabs.

**Details tab:**
- Title and author.
- Status.
- Categories and tags.
- Rating as a 1–10 picker, plus a written review.
- Up next on or off.
- Progress mode and page mode.
- File info: size, pages, "In Drive" plus "On this device" or "Not downloaded", and a Download or Remove download button.
- "Remove book", with an undo toast. This deletes the PDF from Drive, but only once the toast has expired.

**Stats tab:** **[decided: no 25/50/75% milestones]**
- **Timeline:** Added · Started · Finished, with dates. Steps not reached yet show "Not yet".
- **Reading chart:** daily bars from the date added to today, switchable between Pages and Time. If the history is longer than 60 days, the chart groups bars by week.
- **Totals:** time spent, pages read, sessions, days read, average time per page.
- **Notes:** counts of highlights, notes, side notes, summaries and bookmarks. Each count opens the Notes hub filtered to this book and type.
- **Rating and review.**
- **Chapter progress:** the outline with a bar for each chapter, if the book has an outline.

### 9.9 Book panel (inside the reader)
One button ("Contents & notes") opens a tall sheet with 4 tabs. The button shows a badge with the number of annotations on the current page.

- **Contents:**
  - A "Book summary" card at the top.
  - The outline as a collapsible tree, with a progress bar for each chapter and section, and "+ Summary" or "Summary".
  - In marked mode, each item also has a check button.
  - Books with no outline show "This PDF has no chapters. You can still summarize a page range from Notes."
- **Notes:**
  - Actions: "+ Side note on p. N" and "+ Page-range summary".
  - Filter chips: All, Highlights, Notes, Summaries, Areas.
  - Groups: "On this page", then "Rest of the book" in page order.
- **Bookmarks:** sorted by page, each showing its chapter.
- **Search:** as described in 9.5.
- The sheet header has a pencil button that opens book details.

### 9.10 Notes hub (tab)
- Search across the quote, note text, summary text, tags and book title.
- Type chips and tag chips. Results are grouped by book.
- Tapping a highlight or area opens the book at that spot (downloading it first if needed) and flashes it. Tapping a side note or summary opens the editor.

### 9.11 Stats (tab)
- **Week header:** "This week · <date range>". The week starts on the day set in `weekStartsOn`.
- **Totals:** pages read and time spent, each compared with last week.
- **Weekly goals:**
  - A list with progress bars, plus "Add goal".
  - The goal editor sets books (all books or one category), measure (time spent or pages read) and a weekly target.
  - A book in several categories counts toward all of them. **[decided]**
- **Day-by-day chart** for the week, switchable between Pages and Time.
- **Books in progress:** pages, %, and time spent. Tapping one opens its Stats tab.

### 9.12 Reading reminders [decided: feature; delivery method pending owner confirmation]
**Why this needs a workaround:** a PWA with no server can't reliably show a notification at a set time. Web Push needs a server to send the message. Chrome's periodic background sync runs when the browser chooses, which might be hours late.

**Owner decision (2026-11-14):** reminders are push notifications, set up in Settings. Adding them to Google Calendar is an optional extra in Settings. A push notification needs something outside the browser to send it at the right time. The plan: a tiny scheduled sender on a free tier (for example, a Cloudflare Worker with a cron trigger and Web Push). It stores only the push subscription, the schedule and a list of quotes. This gets designed and confirmed with the owner in Plan 5. The Calendar option below stays as the optional extra.

**Calendar option (optional in Settings):** The owner's own Google Calendar already delivers reminders reliably on Android and Windows. Iqra creates the reminder events itself:
- **Settings → Reminders:**
  - On or off.
  - Days of the week, and a time, for example Sat–Thu at 21:30.
  - Quote source: "Highlights from my books", "Built-in quotes" or "Both".
  - A "Calendar" choice: a dedicated "Iqra" calendar that Iqra creates, so reminders are easy to hide or delete.
- **Events:**
  - Iqra creates single events (not one repeating series), 14 days ahead. That way each reminder can carry a different quote.
  - Each event is 15 minutes long, with a popup reminder at the event's start time.
  - Title: "Time to read · <current book title>".
  - Description: the quote, its source (book and page for the owner's own highlights), and a link back into the app at the "Continue reading" book.
  - Every time the app opens, it keeps the 14-day window filled. Changing the reminder settings rebuilds all future Iqra events.
- **Permission:** this needs one extra permission, `https://www.googleapis.com/auth/calendar.app.created`, which covers only calendars the app creates. If Google doesn't accept that permission for this kind of app, the fallback is `calendar.events`. Iqra asks for it only when the owner first turns reminders on, not at sign-in.
- **Built-in quotes:** ~40 short motivational lines about reading, written for Iqra and shown without attribution. This avoids misquoting real people. The owner can add their own lines in Settings.

**Fallback if the owner rejects the Calendar approach:** an in-app nudge only. When the app is opened on a reminder day after the set time, and no reading has happened that day, a card appears at the top of Library with a quote.

```ts
interface ReminderSettings {
  enabled: boolean;
  days: (0|1|2|3|4|5|6)[];         // 0 = Sunday … 6 = Saturday
  time: string;                    // "21:30", local time
  quoteSource: 'highlights' | 'builtin' | 'both';
  customQuotes: string[];
  calendarId?: string;             // the "Iqra" calendar, once created
}
```

### 9.13 Settings (from Library)
- **Account:**
  - The Google account's name and email, and Sign out. Signing out keeps local data, and a prompt asks whether to also clear this device.
  - "Sync now" and the last sync time.
  - "Sync on mobile data", on or off.
- **Storage:**
  - Google Drive usage (from Drive's `about.get` storage quota) as a stacked bar: Iqra books, other files, free.
  - This device's usage (from `navigator.storage.estimate()`): downloaded books, reading data, app.
  - A "Manage downloads" link.
- **Categories:** rename, delete (books are kept; undo toast), and add. Order is set by drag.
- **Reminders:** see 9.12.
- **Reading defaults:** view, page color, progress mode, page mode, week starts on.
- **Your data:**
  - Export notes as Markdown, one file per book, in a zip. The file is generated in the browser.
  - Back up everything as one JSON file.
  - Restore from a backup.
- **About:** version, and a link to the Drive folder.

## 10. Design system and copy

- **Visual direction:** taken from the prototype.
  - A calm, deep-teal accent on neutral surfaces, with a light and a dark theme.
  - Book text in Literata. Interface text in Instrument Sans. Arabic text in IBM Plex Sans Arabic.
  - Highlight colors: yellow, green, blue, pink.
  - Reader page colors: Paper, Sepia, Night.
- **The implementation specs will list every token** (colors for both themes, type scale, spacing, radii, shadows, motion timings) and every component state: default, hover, focus, pressed, disabled, loading, empty, error, offline.
- **Copy rules:**
  - Plain, short and active.
  - Buttons say what happens ("Save", "Remove 3 downloads").
  - Errors say what went wrong and what to do next.
  - No "Are you sure?" for undoable actions.
  - Name things the way the owner says them: "Up next", "Side note", "Reading mode", "Contents & notes".
- **Text direction:** any user text that can be Arabic (titles, notes, summaries, tags) uses `dir="auto"`, and Arabic glyphs get the Arabic font.
- **Accessibility:**
  - Every control is reachable by keyboard and has a visible focus ring.
  - Touch targets are at least 40px.
  - Animations are turned off for anyone who has set the system's reduce-motion option (`prefers-reduced-motion`).
  - Contrast meets WCAG AA in both themes.

## 11. Risks and early spikes

These are test-first tasks at the start of the plan. Each is a small throwaway check that has to pass before building on it.

1. **Arabic text extraction:** run pdf.js `getTextContent` on 2–3 of the owner's Arabic PDFs. Check word order and letter joining for selection, search and reading mode. If it fails, Arabic books stay page-view-only, and only area highlights are reliable for them.
2. **Low-quality English PDFs:** confirm the app detects pages with no text layer and shows the reading-mode fallback.
3. **Sign-in on an installed Android PWA:** confirm the Google popup and the reconnect flow work inside the installed app window.
4. **Large-file performance:** a 600-page, 40 MB PDF must open in under 2 seconds once downloaded, and scroll smoothly in continuous mode, using page virtualization and the worker.
5. **Resumable upload and download** of a 40 MB file on mobile data, including resuming after a network drop.
6. **Streaming from Drive:** pdf.js loads a Drive file using HTTP range requests (`files/{id}?alt=media` with `Authorization` and `Range` headers). Confirm Drive returns 206 responses that the browser allows the app to read. If not, "Read from Google Drive" downloads the file into memory for that session only, without saving it.
7. **Calendar reminders:** create a calendar with the `calendar.app.created` permission and add an event with a popup reminder. Confirm it reaches both the Android phone and the Windows PC.

## 12. Testing approach
- **Unit tests** (Angular's default runner) for the code with real logic:
  - Merge and sync logic.
  - Progress and chapter-range calculations.
  - Session and idle timing.
  - Goal totals.
  - Anchor-to-reflow mapping.
- **A fake Drive adapter** with the same interface as the real one, for tests and for working offline during development.
- **Playwright end-to-end tests** against the fake adapter. Core flows: add book, open, highlight, note, switch device (two browser contexts sharing the fake Drive), and reopen at the synced position.

## 13. Where this overrides the prototype
- Status tabs plus a Filter sheet and a Sort control, instead of two chip rows.
- Books are not downloaded by default. A cloud badge shows on books that aren't downloaded, and Manage downloads replaces the per-book toggle list.
- Progress mode and page mode are per book.
- Contents is a nested tree with chapter progress.
- Summaries can be attached to any outline level.
- Rating (1–10), review, tags and the Up next list are new.
- Book stats live in book details, with a daily chart and no percentage milestones.
- New reader controls: swipe/scroll page modes, Back/Forward through jumps, zoom controls, and text selection with handles.
- No "time left" anywhere. No daily streak.

## 14. Left to the implementation plan
- Exact library versions, project structure and folder layout.
- Component-level specs, the full copy deck (every string), and every design token.
- Task breakdown with acceptance criteria and tests for each task, in this order: spikes → foundation (shell, local DB, auth, Drive adapter, sync) → library → reader → annotations → panel and notes hub → progress, sessions and stats → settings and downloads → polish.
- The phase 2 translation provider. Plan: Chrome's built-in on-device Translator API where available (Windows), falling back to a free web API. To be decided by a spike at the start of phase 2.
