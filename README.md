# Iqra

Iqra (اقرأ) is a personal PDF reader for the web and Android. It works offline with downloaded books and syncs your library, reading progress, highlights, and notes through your own Google Drive. It requires no application server.

[Open the web app](https://ibrahimdiab1.github.io/Iqra/) · [Download the Android APK](https://github.com/IbrahimDiab1/Iqra/releases/tag/android-latest) · [Changelog](CHANGELOG.md)

## What you can do

- Import PDFs, organize them with categories and tags, and download books for offline reading.
- Read in scroll, swipe, or reflow mode, with Arabic and right-to-left support.
- Search within a book, jump to chapters, and resume from your last reading position.
- Save highlights, notes, bookmarks, and summaries. Review saved translations and annotations with spaced repetition.
- Set reading goals, track your progress, and schedule reminders through Google Calendar or Android notifications.

PDFs uploaded by Iqra live in `My Drive/Iqra/Books`. Reading data is stored locally in IndexedDB and synced through Iqra’s private Drive app data folder. The Android app supports Android 7.0 and later.

## Run locally

Use Node.js 22.22.3 or newer within the Node 22 series, as used in CI.

~~~sh
cd app
npm ci
npm start
~~~

Open `http://localhost:4200`. For real Google sign-in in your own deployment, follow the [Google Cloud setup](docs/setup-google.md).

~~~sh
npm test -- --watch=false
npm run build
npm run e2e
~~~

Run these commands from `app/`. Playwright uses Chromium and fake Google services, so its tests do not require access to your Drive.

## Project layout

| Path | Contents |
| --- | --- |
| [app/](app/) | Angular PWA, tests, and Capacitor Android project |
| [docs/](docs/README.md) | Architecture, deployment, and verification |
| [brand/](brand/) | Logos and brand assets |
| [.github/workflows/](.github/workflows/) | GitHub Pages deployment and Android APK builds |

See [Contributing](CONTRIBUTING.md) for development and testing, and [Releasing](docs/releasing.md) for versioning and deployment. The [handoff](HANDOFF.md) records the state at the end of Plan 10.

[Privacy policy](https://ibrahimdiab1.github.io/Iqra/privacy.html) · [Terms of use](https://ibrahimdiab1.github.io/Iqra/terms.html) · [MIT license](LICENSE)
