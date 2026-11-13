# Clearbloom

A fair, ad-funded 8×8 block puzzle with a premium classroom theme. It runs as static HTML and JS, with no build step.

- Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000/
- `js/main.js`: game loop, rendering, input, scoring table, timer, power-ups, levels, and game flow.
- `js/difficulty.js`: documented difficulty rules (shown in the game under "How difficulty works") — including the timer numbers (`TIMER`) and power-up rules (`POWERUPS`). It never imports `ads.js`.
- `js/progress.js`: lifetime player XP + level thresholds + cosmetic milestone rewards (cosmetics only, never difficulty).
- `js/scoring.js`: the scoring table (the only source of points). Power-up clears score 10 points per cell, no combo multiplier.
- `js/ads.js`: ad adapter with `showRewarded()` and `showInterstitial()`. It uses a mock overlay today; sketches for AdMob and AdSense H5 are in comments.
- `js/analytics.js`: event log in `localStorage.gb_events`.
- `js/audio.js`: WebAudio-synthesized sounds + an original synthesized
  upbeat music track (120 BPM marimba loop, 96 s, clean seam; on by default,
  toggle in Settings, remembered; ducks under SFX; a light shaker layer
  fades in during the timer's last 20 s).
- `js/sprites.js`: pre-rendered glossy 3D-style sprites — candy blocks in
  crayon colours (256 px, ~3x cell size, downscaled for crisp 2x/3x DPR),
  wooden tray board, bright paper backdrop with chalk doodles, gold-star
  and confetti particles, and 3D-style UI icons. The frame loop only
  blits; background + board live on a static canvas layer redrawn on
  resize.
- `js/haptics.js`, `js/rng.js` (seeded daily challenge), `js/brand.js`, `js/pieces.js`.
- `CREDITS.md`: music is original, synthesized in-app; fonts (Baloo 2 +
  Fredoka, SIL OFL) are embedded in `style.css` as base64 data URIs.

## Timer

Every game starts with 120 seconds on the glossy bar above the board. Each cleared line adds 6 s, plus 2 s per extra line on a multi-line clear (2 lines = +14 s, 3 lines = +22 s), capped at 150 s. From 20 s a big countdown shows with a gentle tick each second. Time out ends the game like no-moves-left; the opt-in rewarded revive refills the timer to 60 s. The timer pauses during the tutorial, pause/menu, settings, ads, and when the app is backgrounded. Same numbers for everyone — see `TIMER` in `js/difficulty.js`. (The "add 15 s back by clearing lines" wording is covered by +6 s/line plus the Time Star's +15 s; there is no separate +15 s per clear.)

## Power-ups (earned only through play)

One charge per 3-line combo and per 10 lines cleared (at most 3 held, fixed earn rotation: Bomb, Sweep, Reshuffle, Star). Each slot shows a ring filling toward the next 10-line milestone (e.g. 7/10). Boom Bomb clears a 3x3 area (explosion + shockwave), Eraser Sweep clears one chosen row or column (laser swipe), Shuffle Tray deals a new tray (cards flip), Time Star adds 15 s (clock flies into the timer bar). Tap a power-up, then tap its target; tap again or ✕ to cancel. Charges reset every game. Power-up clears score 10 points per cell with no combo multiplier and never earn more power-ups. Never sold, never ad-gated.

## Use-it-or-lose-it + auto-save

Each charge lasts 30 seconds of play time, oldest first — the ring on a filled slot drains as its oldest charge runs down (seconds left shown, pulsing under 5 s), and an expired charge fades away with a soft poof and no points. The clock pauses whenever the game timer pauses (pause/menu, settings, ads, tutorial, background) and while a banner is showing. If no tray piece fits while a charge is held, the game auto-uses one to save you before offering a revive — Reshuffle first, then the Bomb on the 3x3 that makes the most room for a tray piece, then the Sweep on the fullest row or column — with a ~0.6 s freeze, a "SAVED!" banner, the icon flying to its target, and a chime. The choice is deterministic and the same for everyone. Timeout auto-saves only with a Time Star (one charge, +15 s, "SAVED!" banner) — Bomb, Sweep and Reshuffle never fire on timeout; with no Time Star held it ends the game like no-moves-left, with the normal opt-in revive offer.

## Levels

- **In-game level:** starts at Level 1, +1 every 15 pieces placed (max Level 11), using the same `levelFor()` ramp as difficulty. The bar under the score shows progress; levelling up adds +5 s plus a celebration.
- **Player level:** lifetime XP — 10 per line, 5 per max combo, 25 per game played — shown on the home screen with an XP bar. Milestones unlock cosmetic stickers, block skins, board frames and backgrounds only. Neither layer changes difficulty per player.

## Tests

- `tests/design1.mjs` — Playwright tests (timer, power-ups, levels, XP, reduced motion, 0 console errors, FPS incl. 4x CPU throttle). Run: `node tests/design1.mjs` (needs Playwright + Chromium; serves the folder on localhost automatically).
- `tests/sim1.mjs` — median-game estimate for the timer rules (greedy simulated player, ~3 s per placement, level-up +5 s modelled, 30 s charge expiry + auto-save on no-moves modelled). Run: `node tests/sim1.mjs`.
- The upstream 26-test suite lives outside this repo (`/workspace/game-test/test.mjs` in the Games environment).
