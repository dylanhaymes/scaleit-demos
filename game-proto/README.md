# Gridbloom (prototype)
A fair, ad-funded 8×8 block puzzle. It runs as static HTML and JS, with no build step.

- Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000/
- `js/main.js`: game loop, rendering, input, scoring table, and game flow.
- `js/difficulty.js`: documented difficulty rules (shown in the game under "How difficulty works").
- `js/ads.js`: ad adapter with `showRewarded()` and `showInterstitial()`. It uses a mock overlay today; sketches for AdMob and AdSense H5 are in comments.
- `js/analytics.js`: event log in `localStorage.gb_events`.
- `js/audio.js`: WebAudio-synthesized sounds.
- Tests: `/workspace/game-test/test.mjs` (Playwright). Screenshots go in `shots/`.
- See PLAN.md for the path to the app stores.
