# Iqra — handoff

Personal PDF reader ("Iqra", اقرأ): Angular PWA plus a Capacitor Android app. There is no backend and it costs $0 to run. Books are stored in the user's Google Drive (`My Drive/Iqra/Books`), and sync data lives in the Drive appDataFolder. The app is local-first (IndexedDB via Dexie).

- **Repo:** https://github.com/IbrahimDiab1/Iqra (branch `main`, everything pushed).
- **Web:** GitHub Pages at https://ibrahimdiab1.github.io/Iqra/ (`.github/workflows/deploy.yml`, base href `/Iqra/`).
- **Android APK:** `.github/workflows/android.yml` builds on every push to `main` and attaches the APK to the release `android-latest`.

## Stack and commands (run in `app/`)
- Angular 22 (standalone components, signals), pdf.js 6.5, Dexie, Vitest, Playwright. Capacitor 8 for Android (minSdk 24 = Android 7.0, target 36).
- `npm ci`
- Unit tests: `npx ng test --watch=false` (1557 tests passing at handoff).
- Web build: `npx ng build`. The initial bundle is about 522 kB against a 540 kB warning budget. Keep it lean: new pages and sections load lazily through dynamic `import()` + `ViewContainerRef`, because `@defer` costs about 7 kB in the initial bundle.
- e2e tests: `npm run e2e -- --trace off` (94 passing). Chromium is preinstalled; never run `playwright install`.
  - The e2e tests use a fake Drive, fake auth and a fake Calendar, enabled by `FAKE_DRIVE` in the environment files.
  - Default port is 4300. Parallel agents must use their own Playwright config with a private port.
  - In the e2e build the default page mode is `swipe`, because those specs turn pages with the arrow keys.
- Native build: `npx ng build --configuration native` (base href `/`, no service worker), then `npx cap sync android`.
  - Gradle cannot run in Claude cloud sessions: dl.google.com is blocked. Rely on CI.

## Architecture pointers (`app/src/app/`)
- **Data and sync:**
  - `core/` holds models, `Repo` (`put`/`update`/`softDelete`/`live`) and settings.
  - `core/defaults.ts` holds the defaults: page mode scroll (swipe in e2e), progress last page, page view, paper, week starts Saturday.
  - `sync/` does record-level sync: newest `updatedAt` wins, deletions are kept as tombstones.
  - Sync is split into shard files: `library.json`, `book-<id>.json`, `sessions-YYYY-MM.json` and `review.json`. The smart sync scheduler is in `sync/`.
- **Auth:** `auth/` uses the web Google Identity Services token client with silent renewal. `NativeAuthService` (Capacitor `@capgo/capacitor-social-login`) is swapped in for the native build.
- **Reader:** `reader/` (`reader.page.ts`, `reader-actions.ts`, `pdf-session.ts`, text layer, `arabic-text.ts`, `core/direction.ts` `effectiveDirection()`).
  - The text layer is built only for the current page (swipe) or near-viewport pages (scroll). This was the Plan 9 fix for heavy Arabic PDFs.
  - The pdf.js wasm decoders ship under `assets/pdfjs/`; scanned CCITT/JBIG2 PDFs need them.
- **Other screens:**
  - `annotations/` and `notes/`: highlights, notes, bookmarks, summaries and the Notes hub.
  - `review/`: translation (Chrome Translator API, then MyMemory; dictionaryapi.dev for definitions; Web Speech for read-aloud) and spaced-repetition practice (SM-2).
  - `stats/`: overview, goals per day/week/month, heat map, all-time totals.
  - `pages/library/`: greeting, quote, continue reading, category bar.
  - `profile`/`settings`, and `reminders/`: Google Calendar events plus phone notifications on native.
- **Docs:**
  - `docs/specs/2026-11-14-iqra-design.md`: the original design spec.
  - `docs/superpowers/plans/`: plans 1–6 in full, briefs for plans 7–10.
  - `docs/deploy-and-test.md`: manual real-device checklists for each plan.
  - `docs/setup-google.md`: Google Cloud setup.

## State at handoff
- All work through Plan 10 is merged, deployed to Pages, and the Android CI build is green.
- **Android signing is not finished.** The CI release build needs 4 repo secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
  - The owner received the keystore (`iqra-release.jks`) and the values. Claude sessions cannot set secrets: the proxy blocks the Actions secrets API.
  - Until the secrets are set, CI builds a debug APK signed with a random key, so Google sign-in will not work in it.
  - Google Cloud already has an Android OAuth client for package `io.github.ibrahimdiab1.iqra` with SHA-1 `0B:A8:A5:AE:85:D4:D7:5F:FA:C3:8B:7F:42:32:EA:6B:03:86:0D:4E`. The app passes the Web client id (in the environment files) as audience; the Android client id is not used in code.
  - After the secrets are set: re-run "Build Android app" (Actions → Run workflow, or push any change under `app/`). Then check `iqra-release.apk` on the release, native Google sign-in, Drive sync and phone notifications on a real device.

## Known gaps and ideas
- **Untested on real Google or real devices:**
  - Native sign-in and authorization flow (plugin token expiry is assumed to be 1 h).
  - Phone notifications.
  - A 2-hour web session.
  - The Calendar API disabled case.
- **Web sign-in:** the web (PWA) still re-prompts sign-in sometimes, because GIS tokens last 1 h, there is no refresh token, and third-party cookies may be blocked. A proper fix needs a backend; the Android app avoids the problem.
- **Reader:**
  - Swipe-mode "page changes after leaving full screen" could not be reproduced; scroll mode is fixed.
  - Page turns on heavy Arabic PDFs are still about 230 ms each, mostly pdf.js canvas drawing. The canvas cap is 6M pixels; raise it if pages look soft on large high-DPI screens.
- **Minor:** see `.superpowers/` reports. They exist only in the old session, not in the repo. Two examples:
  - A category-delete Undo can be lost when another toast replaces it.
  - Text in the Notes list is not virtualised (it may get slow beyond about 2,500 items).
- **Product ideas discussed:** metadata lookup (Google Books / Open Library), OCR (Tesseract.js), Play Store release ($25), a SaaS version (needs a backend for entitlements and refresh tokens, plus Paddle or Lemon Squeezy for payments).

## Working conventions the owner likes
- Owner's stack is Java/Spring/Angular.
- Save tokens: lean briefs, parallel worktree agents per area, one merged test run, minimal reviews.
- Plain, friendly UI copy for everyday readers (no technical terms).
- Commit trailers in use: `Co-Authored-By: Claude ... <noreply@anthropic.com>` and a `Claude-Session:` link.
