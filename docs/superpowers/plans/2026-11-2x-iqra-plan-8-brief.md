# Plan 8 — Review (language notebook), UI polish, performance/sync fixes (decisions final; lean)

Repo /home/user/iqra (Angular app in app/). Shared rules: TDD for behaviour (RED then GREEN), no subagents, never `playwright install`,
unit `npx ng test --watch=false`, e2e `npm run e2e -- --trace off` ON A PRIVATE PORT (local untracked playwright config or env, not 4300; never pkill other servers),
build initial total <= 515 kB (lazy-load new pages/sections), RTL + 320/390/1280 px no horizontal scroll, light/dark tokens only.
Commit identity `git -c user.name=Iqra -c user.email=noreply@anthropic.com commit`, trailers:
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K6dpUPBWFhLTKhVVYLKT5Y
Save tokens: no audits, no screenshots unless needed to verify a layout; append one bullet per item to a "Plan 8 checks (<group>)" section of docs/deploy-and-test.md.
Gates at the end: unit, build, e2e green once. Report: /home/user/iqra/.superpowers/sdd/plan-8/<group>-report.md + short reply (branch, final SHA).

## Group V — Review tab (translation + language notebook)
V1 Bottom nav order: [Profile, Library, Notes, Review, Stats]. New lazy route /review, nav label "Review" (icon: cards/flip).
V2 Translate in the reader: selection toolbar + context menu get "Translate". Opens a small sheet: the selected text, translation EN->AR (and AR->EN when the source is Arabic; detect by script), for single English words also a short definition + phonetic from https://api.dictionaryapi.dev (free, no key), a speak button (Web Speech API, en-US / ar voices when present), and "Save to Review".
   Provider chain (client only, $0): Chrome built-in Translator API (`Translator.create`, when available) -> MyMemory API (https://api.mymemory.translated.net/get, no key) -> clear offline/error message. Wrap behind a `TranslationProvider` interface so a paid provider can be added later. Cache translations in IndexedDB.
V3 Saved item model `ReviewItem` {id, text, translation, kind word|phrase|sentence (auto by length), sourceLang, bookId, page, context sentence, note?, srs fields, createdAt/updatedAt/deviceId/deleted}. Sync as a new shard `review.json` with the same record-level rules as other tables; include in backup/restore and export.
V4 Review page: list (search, filter by book/kind, edit/delete with Undo), and a "Practice" mode with flashcards in both directions (front EN -> back AR, and AR -> EN, chosen per session or mixed), grading Again/Hard/Good/Easy with a simple SM-2/Leitner schedule; "N due today" badge on the nav item; keyboard (Space flip, 1-4 grade); speak button on cards; empty states with helpful copy.

## Group U — UI and goals
U1 Profile and Stats: each block in its own clearly separated card/section (surface background, radius, spacing, heading) for quick scanning.
U2 Library: Filter and Sort buttons without borders (ghost style, keep focus ring). Category bar and Stats category filter: one line, horizontally scrollable, scrollbar hidden (scrollbar-width:none + ::-webkit-scrollbar{display:none}), keep keyboard/touch scrolling.
U3 Goals: no default goal anywhere (new users have none; do not migrate away goals users set). The user chooses the period per goal: day, week or month (pages or minutes, as today). Update Stats overview/goal displays and the reminders/goal logic accordingly (remove the weekly/7 derivation; show the goal for its own period).
U4 Library greeting "Welcome, {first name}": a rotating stat line changing every 3 s (fade; no animation under reduced motion; pause on hover/focus; not aria-live): read time today -> pages today -> remaining to goal (nearest period first: day, then week, then month; pages or time as the goal is defined; skip when no goal or reached -> "Goal reached") -> all-time pages -> all-time time -> books finished (only if > 0).
U5 First-run onboarding: short, skippable, 3-4 steps (what Iqra does; books live in your Google Drive; add your first book; optional goal setup), progress dots, Back/Next/Skip, accessible, shown once (flag in settings), reachable again from Profile ("Show intro").
U6 Remove the sentence "Iqra means \"read\" in Arabic" from the welcome page.
U7 Default page mode = paged (one page at a time, swipe), not scroll; existing users keep stored values. (Update core/defaults.ts; the e2e FAKE_DRIVE special-case can go if paged is the default.)
U8 Mobile/touch: no custom context menu on long-press in the reader page (keep native text selection); right-click menu stays for mouse.

## Group P — Critical performance and sync reliability
P1 Arabic book lag + tab memory > 1 GB for a 3.4 MB PDF. Diagnose first with a heavy fixture (generate a 150+ page Arabic PDF with the existing arabic fixture script; do not commit large files, generate in e2e setup or keep < 1 MB) and measure (performance.measureUserAgentSpecificMemory or CDP Performance.getMetrics / heap snapshots) while paging/scrolling and selecting. Likely suspects: page canvases/bitmaps kept for all pages (release off-screen: canvas.width=0, page.cleanup(), limit cache to visible +/- 2), devicePixelRatio x zoom canvases too large (cap total pixels), text layers kept for every page, textItems/Arabic reorder/normalisation recomputed on every selectionchange (memoise per page, debounce selection handlers with rAF), highlight layer re-render per event, pdf.js document not destroyed on leave. Fix root causes; add a regression test (e.g. number of live canvases bounded after paging through 50 pages; selection handler work memoised).
P2 Mobile app sometimes stuck: no sync and Stats page empty until reinstall. Investigate and harden: (a) stale service worker/lazy chunk load failures after a deploy (handle ChunkLoadError / failed dynamic import globally -> one automatic reload; SwUpdate: check on open + on visible, activate and reload when idle, handle `unrecoverable` state), (b) sync lock/in-flight promise that never settles (timeout + always release in finally), (c) Dexie open blocked/versionchange (close and reload), (d) Stats page must render with empty/failed data instead of blank (error state + retry). Add tests for each hardened path.
