# Iqra

A personal PDF reader that runs in the browser and installs like an app on Android and Windows. Your books live in **your own Google Drive**, so there is no server to run and nothing to pay for. Your library, reading position, highlights and notes stay in sync across devices.

> **Status: early development.** Plans 1 (foundation and library) and 2 (the reader) are built. Annotations and stats come in the next plans. See [Roadmap](#roadmap).

## What works today

- Sign in with Google. Iqra only sees files it created and its own hidden app folder.
- Add PDFs. Title, author, chapters (outline), language and cover are read from the file, and the PDF is uploaded to `My Drive/Iqra/Books`.
- One library on every device, synced in the background. It always works offline and saves locally first.
- A library with status tabs (Reading, To read, Finished, All), filters (categories, tags, rating, downloaded only), sorting, an "Up next" ranked list and a "Continue reading" card.
- Books are downloaded only when you ask. A book that isn't on the device can be read straight from Drive or downloaded.
- Remove a book from the device only, or delete it everywhere (including Drive) with a 10-second undo.
- Book details: title, author, status, categories, tags, rating, review, progress mode and file info.
- Arabic and English text, with right-to-left support in titles and notes.

- A real reader. Page view with swipe or keys, or continuous scrolling. Zoom (pinch, Ctrl+wheel, double-tap), a reading mode that reflows the text with adjustable size and page colour (paper, sepia, night), and Arabic right-to-left support.
- Contents (the PDF's chapters) and search inside the book. Jumping to a chapter or search result keeps a Back and Forward history (Alt+arrows on the PC).
- Books open where you left off, on every device. If another device read further, Iqra opens there and offers "Back to p. N" for the page you were on.

## Roadmap

| Plan | What it adds |
|---|---|
| 1 (done) | Sign-in, Drive, sync, library, adding and removing books, book details |
| 2 (done) | The reader: page view and reading mode, swipe and scroll, zoom, back/forward, opening at your last place, search in the book |
| 3 | Highlights, notes, summaries, bookmarks, the Contents & notes panel, the Notes hub |
| 4 | Reading time, progress and chapter progress, weekly goals, stats |
| 5 | Settings, storage, managing downloads, export, reading reminders |
| Later | Language notebook (translate to Arabic, flashcards), OCR, text-to-speech |

## Known issues

- If the same PDF is added on two devices at almost the same moment, both copies can be removed. A fix is planned before real use.
- After the app returns from the background with an expired sign-in, you need one tap on "reconnect".
- Not yet tested against real Google Drive with large files (see `docs/deploy-and-test.md`).

## Tech

Angular (standalone components, signals) · TypeScript · IndexedDB via Dexie · pdf.js · Google Identity Services and the Drive REST API · service worker (PWA) · Vitest · Playwright.

There is no backend. All data is in the browser's IndexedDB and in your Google Drive.

## Getting started

```bash
cd app
npm ci
npm start          # http://localhost:4200
npm test           # unit tests
npm run e2e        # end-to-end tests (uses a fake Google Drive)
```

Sign-in needs a Google OAuth client ID. The one in `app/src/environments/environment.ts` belongs to the owner's Google Cloud project and only allows its own origins. To run your own copy, create your own project and client ID (steps in `docs/setup-google.md`) and replace `googleClientId`.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which tests, builds and publishes to GitHub Pages. In the repository settings, set **Pages → Source** to **GitHub Actions**. The site is then served at `https://ibrahimdiab1.github.io/Iqra/`, and that origin must be listed as an authorized JavaScript origin on the OAuth client. The full checklist is in `docs/deploy-and-test.md`.

## Docs

- Design: `docs/specs/2026-11-14-iqra-design.md`
- Plan 1: `docs/superpowers/plans/2026-11-14-iqra-plan-1-foundation-library.md`
- `folio-prototype.html`: the clickable UI prototype, made before the app was named Iqra.

## Links

- App: https://ibrahimdiab1.github.io/Iqra/
- Privacy Policy: https://ibrahimdiab1.github.io/Iqra/privacy.html
- Terms of Use: https://ibrahimdiab1.github.io/Iqra/terms.html
- Logo files (SVG and transparent PNGs): [`brand/`](brand)

## License

[MIT](LICENSE). Iqra depends on open-source packages (Angular, pdf.js, Dexie and others) that keep their own licenses. The bundled fonts (Literata, Instrument Sans, IBM Plex Sans Arabic) are under the SIL Open Font License.
