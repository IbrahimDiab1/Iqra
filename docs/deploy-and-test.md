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
