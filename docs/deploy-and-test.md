# Deploy and test: owner checklist

The CI workflow (`.github/workflows/deploy.yml`) runs unit tests and builds the app on every push to `main`, then publishes it to GitHub Pages. The site is served from `https://ibrahimdiab1.github.io/Iqra/`.

## 1. Push the repository to GitHub

- Create an empty GitHub repository named `Iqra`.
- Push this repository's `main` branch to it.

## 2. Enable GitHub Pages

- In the repository: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
- Run the "Deploy to GitHub Pages" workflow (Actions tab → Run workflow), or push to `main`.
- Confirm the site loads at `https://ibrahimdiab1.github.io/Iqra/`.

## 3. Check the OAuth origin

- In Google Cloud, the OAuth client's authorized JavaScript origins must include `https://ibrahimdiab1.github.io` (the origin only, no path). This was needed from Task 0.
- If sign-in fails with an origin mismatch error, this is the first thing to check.

## 4. Install the app

- **Android phone:** open the site in Chrome → menu (⋮) → Install app.
- **Windows PC:** open the site in Edge or Chrome → install icon in the address bar (or menu → Install Iqra).

## 5. Acceptance checks

- Sign in on both the phone and the PC.
- Add a PDF on the PC. It should appear on the phone within 2 minutes, or right away after reopening the app.
- Open and stream the PDF on the phone.
- Turn on airplane mode. The library still loads, and the status reads `Offline · changes are saved on this device`.

## 6. Google Drive items to verify

- **Resumable upload of a large PDF:** upload a PDF of 50 MB or more from the PC. It should finish, and an interrupted upload should resume rather than restart.
- **Streaming a book from Drive:** open a book stored in Drive on the phone without downloading it first. Pages should load on demand.

## 7. Reader checks

Real-device and real-file checks that the automated tests cannot cover.

- **Normal PDF, phone and PC:** open a book on each. Page view shows one page. Swipe left and right on the phone to turn pages; use the arrow keys, PageUp/PageDown or Space on the PC. On Android, pinch to zoom; on the PC, hold Ctrl and use the mouse wheel. Double-tap (or double-click) zooms in and out. The header and the right-hand toolbar are always visible (see section 12).
- **Arabic PDF:** open a book in Arabic. Check that text is selectable, that reading mode keeps the correct order and joined letters, and that a search finds a word both with and without harakat. Swiping right should go to the next page.
- **Scanned or low-quality PDF:** open a scan with no text layer. Reading mode should say the page has no selectable text and offer "Show page".
- **Large PDF (about 600 pages, 40 MB):** after downloading, the first page should appear in under 2 seconds. Scrolling in continuous mode should stay smooth.
- **Stream from Drive on mobile data:** turn off Wi-Fi and open a book that is not downloaded with "Read from Google Drive". Pages should load as you read.
- **Two devices:** read to a page on one device, wait a few seconds, and open the same book on the other. It should open on the newest page and offer "Back to p. N" for the page it was on before.

## 8. Highlights and notes checks

Real-device checks for annotations that the automated tests cannot cover.

- **Selection on Android:** long-press a word, drag the handles to extend it, and check the toolbar follows the selection.
- **Word tap:** a single tap on a word in page view selects that word. A tap on empty space does nothing; the header and toolbar stay visible.
- **Colors save instantly:** tapping a color dot saves the highlight at once, with an Undo toast.
- **Swipe and selection:** while a selection exists, swiping must not turn the page.
- **Pinch with highlights:** pinch-zoom still works with highlights on the page, and the highlights stay aligned with the text at every zoom.
- **Arabic:** select Arabic text and highlight it. The colored rectangles must line up with the letters (right-to-left, joined forms), in page view and in reading mode.
- **Themes:** highlights are readable in paper, sepia and night.
- **Note dot:** a highlight with a note or tags shows its dot. Tapping the highlight opens the note.
- **Area highlight on touch:** turn on "Highlight an area", drag a rectangle with a finger, and pick a color. Swiping and pinching are off while the tool is on.
- **Notes hub:** search in the Notes tab, including Arabic words. Tapping a result opens the book at that page and pulses the highlight.
- **Sync:** highlight a passage on one device. It should show on the other device within about a minute.
- **Scanned PDF:** a page with no text layer cannot be selected, but the area highlight and bookmarks still work.

## 9. Progress and stats checks

Real-device checks for reading time, progress and goals that the automated tests cannot cover (they would need real minutes and real devices).

- **Idle pause:** read a page, then leave the book open and untouched for 2 minutes. The time read in the book's Stats tab must stop growing at about 2 minutes. Touching the screen resumes it.
- **Background ends the session:** read for a minute, switch to another app or lock the phone, and come back. The earlier time is kept as one session and a new one starts when you read again.
- **Killed app:** read for a minute, force-stop the browser, and reopen. The time read so far (to the last 30 second checkpoint) is still there.
- **Sync:** time, pages and sessions read on one device appear in the Stats tab on the other device after a sync, and neither device loses the other's sessions.
- **Saturday week start:** the week in Stats runs Saturday to Friday. The day-by-day chart starts on Saturday.
- **Goals with a book in two categories:** put one book in two categories, set a pages goal for each, and read. The pages count toward both goals. A goal for all books counts every book once.
- **Finish prompt:** in last-page mode, reach the last page. "Mark as finished?" appears once. The action sets the book to Finished with today as the finish date. In marked mode the prompt appears when the last unmarked page is marked, either with Mark read or with the check in Contents.
- **Mark read:** in marked mode, the Mark read button toggles the current page, the library progress follows, and checking a chapter in Contents marks every page of it (unchecking clears them). Switching back to last-page mode keeps both sets of data.
- **Very large PDF:** open a book of 600 or more pages with many chapters. Contents opens quickly and every chapter shows a progress bar.
- **Clock and time zone change:** move the phone's clock back by an hour, or change its time zone, while reading. Time read never goes negative and the same page is not counted twice on one day.

## 10. Settings and reminders checks

Real-device checks for Settings, your data and Calendar reminders. The automated tests run against fakes (fake Drive, fake Calendar), so none of this has been proven against Google yet.

### Reminders: first run against real Google Calendar

The real Calendar adapter (`reminders/google-calendar.ts`) has never talked to Google. Do these steps in order on one phone, with the browser's remote debugging or a desktop browser open next to it so you can read the network and console errors.

1. **Prepare Google Cloud** (`docs/setup-google.md`, step 2): in the "Iqra" project, **enable the Google Calendar API** (APIs & Services → Library → Google Calendar API → Enable), and **add the scope `https://www.googleapis.com/auth/calendar.app.created`** to the OAuth consent screen. Without the API enabled, Google answers 403 "Calendar API has not been used in project..." and Iqra shows "Reminders stay off". Without the scope on the consent screen, the grant is refused or the token lacks the scope.
2. **Sign in normally first.** The sign-in page must not mention Calendar. Reminders must not ask for anything at sign-in. If a Calendar permission shows up here, that is a bug.
3. **Settings → Reminders → switch on.** Look for: Google's consent window listing only "See, create, and delete secondary Google calendars you have created" (the app-created scope). On an unverified or Testing app also the "Google hasn't verified this app" notice: Advanced → Go to Iqra. After you accept, the switch stays on and the "Connecting to Google Calendar…" line goes away.
4. **Open Google Calendar** (calendar.google.com or the app) and check that:
   - a calendar named **Iqra** exists in "My calendars" (if the name or color is wrong, note it);
   - it holds up to **14 days** of single events (not a repeating series), at your chosen time, **15 minutes long**, on the chosen days only;
   - the title is `Time to read · <book title>` of the book you opened most recently (or `Time to read` with no book);
   - the description has the quote, its source (book and page for a highlight) and a link that opens the app at that book;
   - each event has a **popup reminder at the start** (open one event: "Notification, 0 minutes before").
5. **The popup reaches the phone.** Set the time to 3 minutes from now (the "Send a test reminder" button adds one about 2 minutes ahead). On the phone, the Google Calendar app must show a notification with the quote at that time. Calendar notifications must be allowed in Android/iOS settings; if nothing arrives, check that the Iqra calendar is shown and notifications are on for it in the Calendar app (Settings → Iqra).
6. **Changing days or time rebuilds.** Change the time and untick a day. After about a second, old future events disappear and new ones appear at the new time. Switch the quote source. Count the events: no duplicates, still at most 14 days.
7. **Re-opening the app repeatedly** (close and open it five times in a minute): the event count must not grow. Then leave it for a day and open it again: the window slides forward by one day and keeps exactly 14 days.
8. **Two devices:** on the second device sign in, open Settings → Account → Sync now, wait until Settings show reminders on, then turn on there. Look in Calendar: still **one** Iqra calendar and no doubled events. Open the app on both devices: still no doubles. (If a second "Iqra" calendar appears, the calendar id did not sync before enabling; report it.)
9. **Revoked permission:** at <https://myaccount.google.com/permissions> remove Iqra's access, reload the app. Reminders show "Iqra needs Google Calendar access again" with a Reconnect button, and there is no retry loop (check the network tab: no repeating Calendar requests). Reconnect restores them.
10. **Switch off:** answer "Yes" to remove upcoming reminders. The events disappear from the Iqra calendar. Switch on again: they come back (Google keeps deleted event ids reserved; Iqra must still be able to recreate them. If events do not come back after remove and re-enable, report it).
11. **Time zone and daylight saving:** change the phone's time zone, reopen the app. Events stay at your chosen local time in the new zone (21:30 stays 21:30). Around a daylight saving change, the events after the change are still at the chosen local time.
12. **What to record if anything fails:** the HTTP status and message of the failing request (Network tab), the exact toast or line shown in Settings, and whether the Iqra calendar exists in Google Calendar.

### Settings, storage and your data

- **Settings from the gear:** the Library gear opens Settings. The account email shows. Back returns to the Library.
- **Reading defaults:** change the week start, default progress mode, page mode and theme, reload, and they are kept. On a second device they arrive after a sync.
- **Categories:** add, rename, reorder, delete with Undo. A deleted category disappears from books that used it, and Undo brings it back.
- **Sign out, keep data:** signs out, local books stay. Signing back in finds them.
- **Sign out and clear this device:** after confirming, the device shows the welcome screen and nothing is left (check Application → IndexedDB in the browser tools). Nothing is deleted from Drive: sign in again and the library is pulled back. Cancel at the confirm sheet keeps everything.
- **Storage:** with a library of a few hundred MB, the Drive bar and the "Used by Iqra" number match what Google Drive shows (drive.google.com → Storage, and "Hidden app data" for synced records). With a Google account that has unlimited storage there is no percentage and no broken bar. The device bar matches Chrome's Site settings storage use within a few MB.
- **Manage downloads:** lists downloaded books with sizes, largest first. Removing one frees space and the book stays in the library as "Not downloaded". A book still uploading stays and says so. "Remove all" asks first.
- **Sync on mobile data:** turn it off, switch the phone to cellular only, change something, and no sync happens until Wi-Fi returns. Turn it on and it syncs on cellular.
- **Export notes:** the zip opens on the phone and on a computer; there is one Markdown file per book with notes, Arabic shows correctly, and a title with `/ : ? "` still gives a valid file name.
- **Backup and restore:** take a backup, then on a second device (or after clearing the first) restore it. Books and notes come back, and nothing newer on the device is overwritten. Restoring a random file shows an error and changes nothing.

## 11. Sign-in and sync checks (a two-hour session)

Real-account checks that need real time; the unit tests cover the logic with a fake clock.

- **Stay signed in for two hours:** sign in, keep Iqra open in a visible tab (reading or in the Library) for at least 2 hours and make a change every so often. There must be no "Reconnect" bar and no popup; changes keep reaching Drive (check the status line, or open Iqra on another device).
- **Background tab:** leave the tab hidden for more than 1 hour, then switch back to it. Within a few seconds the status returns to "Synced" without a click. If your browser blocks the silent renewal, one "Reconnect to keep syncing" bar appears; one click fixes it and the pending changes sync right away.
- **Offline for an hour:** turn on airplane mode, read and highlight for an hour, then go online. There must be no popup while offline; after reconnecting, the changes sync (silently, or after the single Reconnect click).
- **Sync timing:** change a setting, wait about 5 seconds, and see it on another device. Leave a book: its position reaches the other device without waiting for the 2-minute poll. Open the Library after more than a minute away: it syncs on arrival.
- **Back button:** Library → open a book → browser Back returns to the Library; Library → book → header back arrow → Settings → browser Back returns to the Library, not to the book.
- **Calendar errors:** with the Google Calendar API disabled in the Cloud project, turning reminders on shows "Google Calendar API isn't enabled for this project…" with `403 accessNotConfigured` under it. Enable the API and try again.

## 12. Plan 6 checks

Real-device checks for the reader and library overhaul. Use an Android phone (Chrome, installed PWA) and a Windows PC. Record the device, the browser and the exact message for anything that fails.

- **Reader chrome:** the header (back, title, chapter › section, page indicator) and the right-hand toolbar are always visible, in light, dark and sepia, in portrait and landscape, and in full screen (F). The page indicator opens "Go to page"; Enter jumps and the header's jump-back button returns. Hover (PC) or Tab to (keyboard) each toolbar icon and read its label; labels do not show on a touch screen, so on the phone check the icons by their action instead.
- **Side drawer:** the Contents button opens the drawer on the right, beside the toolbar and never as a centred pop-up. On the phone it covers most of the screen with a dimmed page; on a wide PC it docks without a dim. Esc or the close button closes it and focus returns to the toolbar button.
- **Two-hour session without re-login:** sign in, keep Iqra open for 2 hours reading and changing things. No Reconnect bar and no popup; changes reach Drive. Then follow section 11 for the background-tab and offline cases.
- **Arabic search and selection:** in an Arabic book, search a word with and without harakat, with Arabic-Indic digits, and one written in presentation forms. Hits jump to the page and the word is highlighted. Select a word, a line and a few lines by dragging; the selection box sits on the text, "Copy" gives the right letters in the right order, and a highlight lands on the selected words. Try a page where each word is its own text run.
- **Back button:** Library → book → browser Back (and the Android system Back) returns to the Library. Library → book → header back arrow → Settings → Back returns to the Library, not to the book.
- **Calendar error message:** with the Google Calendar API disabled in the Cloud project, turning reminders on shows "Google Calendar API isn't enabled for this project" with the `403 accessNotConfigured` detail. Enable the Calendar API in the Cloud console (APIs & Services → Library → Google Calendar API → Enable), wait a minute and try again: reminders turn on. If the message is wrong or missing, send the status line from the Network tab.
- **Keyboard shortcuts (PC):** press `?` for the cheat-sheet and try each: arrows, PgUp/PgDn, Space, C, N, `/` and Ctrl+F (opens the book search, not the browser's), G, B, M, A, R, F, Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y, Alt+← and Alt+→, Shift+F10 or the Menu key. With an Arabic keyboard layout Ctrl+Z, Ctrl+Y and Ctrl+F must still work. Shortcuts must do nothing while typing in a field (search box, note, Go to page). Holding Ctrl+Z must not undo the whole history.
- **Undo and redo:** highlight, add a note, bookmark, mark a page, delete a highlight, then undo and redo each from the toolbar and with the keys. Each shows "Undid …" or "Redid …". A change made on another device in the meantime says "Changed on another device" instead of overwriting it.
- **Context menu and long-press:** on the PC right-click a page and with text selected. The menu opens at the pointer, stays inside the window, arrows move through it and Esc closes it. On the phone long-press empty page space: the menu opens once, without the system text-selection bubble fighting it; long-press a word still selects it. Page actions (bookmark, mark read, area highlight, side note, summary, go to, copy page text) all work from it.
- **Category bar and multi-select:** in the Library tap a category to show only its books; tap All to clear. Long-press a second category on the phone (or Ctrl/Shift-click on the PC) to add it: books of either category show. The selected chips look selected; with two or more selected (or one scrolled out of view) one "2 categories" chip with a clear button appears under the bar. Select a category that is far along the bar (with many categories) and reload: the bar scrolls to show it. Rename, move and delete a category from its menu: on the PC right-click a chip or use its "…" button; on the phone the menu is only reached through the "…" button, which shows on the selected chip (a long-press does not open the menu, it toggles the chip). Delete shows Undo. Scroll the bar sideways with many categories and with Arabic names; an open menu closes when the page scrolls. If the Library is opened offline for the first time after an update and the bar cannot load, "Categories couldn't load · Retry" shows and Retry brings the bar back.
- **Heat map on the phone:** Stats → Month and Year. Each day is coloured by its busiest category in four shades and the legend chips filter it. In Year the blocks are small: tap one, then use the large previous-day and next-day buttons beside "Read on …" to walk through days; the list of books for that day is shown and tapping a book opens its details. The weekday labels stay visible while the year scrolls. Check it in portrait on a small phone (about 360 px wide) and with the system font size on "Large". With Android's reduced-motion setting on, nothing animates.
- **Sepia and dark text contrast:** the chapter line under the title and the page indicator are readable in sepia and night themes in daylight.

## Plan 7 checks (Library, Profile, settings)

- **Library home (L1, L2):** the page opens on All, tabs read All, Reading, To read, Finished. The top shows "Welcome, {first name}" (just "Welcome" without a Google name) with the current streak and all-time reading time. "Continue reading" lists up to five recently read books and is absent when none; then the "Library" header with Add PDF, the tabs, the category bar with Filter and Sort on its right (they wrap under the bar on a 320 px phone), then compact cards with "p. read/total · %" and a category dot in the same colour that category has on Stats. No horizontal page scroll at 320, 390 and 1280 px, in RTL and in dark mode.
- **Profile tab (L3):** the bottom bar is Library, Notes, Stats, Profile. Profile shows the Google photo (or an initial), name and email, then Sync and account (with Sign out), Storage, Reminders and Your data. Opening `/settings` lands on Profile.
- **Settings removals (L4):** no Categories, Reading defaults, quote source, own lines or test reminder anywhere. Reminders still fill the Iqra calendar with built-in quotes. A fresh account opens books in scroll mode with progress by last page and paper colour; an account that had chosen other defaults keeps them.
- **Save a copy (L5):** Profile → Storage → Manage downloads → "Save a copy" on a book downloads its PDF to the device's Downloads folder (check on the phone: the browser's download notification, then the Files app).
