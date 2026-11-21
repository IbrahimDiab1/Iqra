# Plan 9 — owner feedback (decisions final; lean)
Shared rules: same as /home/user/iqra/.superpowers/sdd/plan-8/brief.md "Shared rules" (TDD, private e2e port, never pkill others, initial bundle should not grow beyond 520 kB, commit identity + trailers, Plan 9 checks bullets in docs/deploy-and-test.md, report to /home/user/iqra/.superpowers/sdd/plan-9/<group>-report.md, short reply with branch + SHA). Plain, friendly copy for non-technical readers.

## Group A — Arabic lag (critical)
Owner's real book (copyrighted, NEVER commit): /tmp/claude-0/-home-user-iqra/0c3dc6e1-f4a9-5546-8706-29675704ce57/scratchpad/arbook/book.pdf (299 pages, 2.6 MB, Acrobat Distiller, embedded CID Calibri/Arial, Arabic presentation forms, words split into many small text items). Owner: lag when navigating and selecting text; tab memory > 1 GB. Plan 8 measured only synthetic fixtures and found nothing — reproduce with THIS file in the app (import it through the e2e fake Drive or a local harness), both swipe and scroll modes, and text selection. Measure: CDP Performance.getMetrics (JSHeapUsedSize, Nodes, LayoutCount), process RSS, number of text-layer spans/DOM nodes, long tasks during selectionchange, time per page render. Find root causes (suspects: text-layer span count per page x pages kept in DOM, Arabic reorder/normalise cost per item, selection handlers doing O(items) work per event, highlight/search overlays recomputed, fonts loaded per page, all-page text extraction for search/headings at open). Fix them, report before/after numbers, add a regression test on a synthetic fixture that mimics the structure (many small Arabic items per line).

## Group B — Reader
B1 Defaults: page mode = scroll; view = page view (not reading mode). Existing stored values stay.
B2 Translate popup: small, compact, readable (anchored near selection, max-width ~320 px, no sheet); closes on Save (with a brief toast "Saved to Review") and on outside click/Esc.
B3 Selection toolbar: add a Listen (speaker) button next to Translate (Web Speech API, language by script; stop on second press).
B4 Desktop/web: the Contents drawer opens on the LEFT side (phones keep their current layout). In RTL mirror.
B5 Book settings in the reader: "Text direction" Auto (detected) / Right to left / Left to right, saved per book (synced). Detection sets the initial value; the user's choice overrides detection everywhere (page order/swipe direction, text-layer reading order, reflow, search, selection).

## Group C — Library, Stats, Review, Notes, onboarding, copy
C1 Library: split into clearly separated sections/cards like Profile/Stats (greeting, Continue reading, Library). Add brand: Iqra logo/wordmark in the header (reuse the app icon assets in app/public or src/assets), colours from the brand tokens; keep it calm.
C2 Greeting line: a short "quote of the day" (built-in quotes, rotate daily, keep <= ~60 chars, ellipsis) shown first on the same line as the rotating stats (quote · stat).
C3 Stats: Goals section right after Overview.
C4 Review: kinds filter [All, Words, Sentences] (drop Phrases; existing phrase items count as Sentences).
C5 Onboarding copy rewrite for everyday readers: no technical terms (no "server", "JSON", "Drive appData", "either direction"); mention right-click (or long-press "⋯") on a book for details/actions, and Stats for progress. Also rewrite Backup/Restore copy ("Back up everything") in plain words (e.g. "Save a backup file of your notes, highlights and progress").
C6 App start: Library is the home page (default route and after sign-in), even though Profile is first in the nav.
C7 Notes type chips [All, Highlights, Notes, Summaries, Bookmarks] on one line, horizontally scrollable, scrollbar hidden.
