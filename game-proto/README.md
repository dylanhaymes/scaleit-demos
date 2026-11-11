# Clearbloom

A fair, ad-funded 8×8 block puzzle. It runs as static HTML and JS, with no build step.

- Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000/
- `js/main.js`: game loop, rendering, input, scoring table, timer, power-ups, and game flow.
- `js/difficulty.js`: documented difficulty rules (shown in the game under "How difficulty works") — including the timer numbers (`TIMER`) and power-up rules (`POWERUPS`). It never imports `ads.js`.
- `js/scoring.js`: the scoring table (the only source of points). Power-up clears score 10 points per cell, no combo multiplier.
- `js/ads.js`: ad adapter with `showRewarded()` and `showInterstitial()`. It uses a mock overlay today; sketches for AdMob and AdSense H5 are in comments.
- `js/analytics.js`: event log in `localStorage.gb_events`.
- `js/audio.js`: WebAudio-synthesized sounds + an original synthesized ambient music track (on by default, toggle in Settings, remembered).
- `js/haptics.js`, `js/rng.js` (seeded daily challenge), `js/brand.js`, `js/pieces.js`.
- `CREDITS.md`: music is original, synthesized in-app — no licensed assets.

## Timer

Every game starts with 90 seconds on the thin bar above the board. Each cleared line adds 6 s, plus 2 s per extra line on a multi-line clear (2 lines = +14 s, 3 lines = +22 s), capped at 120 s. Time out ends the game like no-moves-left; the opt-in rewarded revive refills the timer to 60 s. The timer pauses during the tutorial, pause/menu, settings, ads, and when the app is backgrounded. Same numbers for everyone — see `TIMER` in `js/difficulty.js`.

## Power-ups (earned only through play)

One charge per 3-line combo and per 10 lines cleared (at most 3 held, fixed earn rotation: Bomb, Sweep, Reshuffle, Petal). Bloom Bomb clears a 3x3 area, Line Sweep clears one chosen row or column, Reshuffle deals a new tray, Time Petal adds 15 s. Tap a power-up, then tap its target; tap again or ✕ to cancel. Charges reset every game. Power-up clears score 10 points per cell with no combo multiplier and never earn more power-ups. Never sold, never ad-gated.

## Tests

- `tests/design1.mjs` — Playwright tests for this update (timer, power-ups, save/restore, 0 console errors). Run: `node tests/design1.mjs` (needs Playwright + Chromium; serves the folder on localhost automatically).
- The upstream 26-test suite lives outside this repo (`/workspace/game-test/test.mjs` in the Games environment).
