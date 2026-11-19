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

- **Normal PDF, phone and PC:** open a book on each. Page view shows one page. Swipe left and right on the phone to turn pages; use the arrow keys or the on-screen arrows on the PC. On Android, pinch to zoom; on the PC, hold Ctrl and use the mouse wheel. Double-tap (or double-click) zooms in and out. Tap the page to hide and show the bars.
- **Arabic PDF:** open a book in Arabic. Check that text is selectable, that reading mode keeps the correct order and joined letters, and that a search finds a word both with and without harakat. Swiping right should go to the next page.
- **Scanned or low-quality PDF:** open a scan with no text layer. Reading mode should say the page has no selectable text and offer "Show page".
- **Large PDF (about 600 pages, 40 MB):** after downloading, the first page should appear in under 2 seconds. Scrolling in continuous mode should stay smooth.
- **Stream from Drive on mobile data:** turn off Wi-Fi and open a book that is not downloaded with "Read from Google Drive". Pages should load as you read.
- **Two devices:** read to a page on one device, wait a few seconds, and open the same book on the other. It should open on the newest page and offer "Back to p. N" for the page it was on before.

## 8. Highlights and notes checks

Real-device checks for annotations that the automated tests cannot cover.

- **Selection on Android:** long-press a word, drag the handles to extend it, and check the toolbar follows the selection.
- **Word tap:** a single tap on a word in page view selects that word. A tap on empty space still hides and shows the bars.
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
