# Clearbloom credits

- **Music:** original, synthesized in-app with WebAudio (`js/audio.js`). No
  audio files, no third-party music, no CC0 assets. The track is a bouncy,
  upbeat 120 BPM classroom loop — marimba plucks, light claps, simple
  mid-range bass, playful pentatonic melody — built once from a fixed seed
  as a 96-second loop with a clean seam, generated live in the browser.
  Nothing to license, nothing to attribute.
- **Art:** all in-game art is drawn in code (canvas + CSS). No stock images,
  no third-party assets. The premium classroom look is pre-rendered 2D
  sprites (`js/sprites.js`): glossy candy blocks in crayon colours, a wooden
  tray board, a bright paper backdrop with chalk doodles, gold-star and
  confetti particles, and 3D-style UI icons (settings, menu, power-ups,
  stars, trophies) — all rendered once into offscreen canvases and blitted.
  No real-time 3D engine, no image files.
- **Fonts:** Google Fonts, both under the SIL Open Font License 1.1 (free
  for commercial use, no attribution required beyond the license itself):
  - **Baloo 2** (display: score, titles, buttons) — SIL OFL 1.1,
    https://fonts.google.com/specimen/Baloo+2
  - **Fredoka** (body text) — SIL OFL 1.1,
    https://fonts.google.com/specimen/Fredoka
  Self-hosted: embedded in `style.css` as base64 data-URI @font-face rules
  (variable fonts, latin subset only, ~63 KB of font data, ~84 KB base64),
  with system-font fallbacks. No font files, no network fetch, so the game
  works offline. The original woff2 files are kept at
  `~/workspace/clearbloom/design5/fonts-src/` (not in the repo) and can be
  decoded back out of the CSS.
- **Fairness:** difficulty, timer and power-up numbers live in
  `js/difficulty.js` and `js/progress.js` (same for everyone, never
  per-player, never ad-based). No random rewards, no loot boxes, no
  near-miss manipulation, no fake jackpots — the casino-grade juice is
  visual only.
