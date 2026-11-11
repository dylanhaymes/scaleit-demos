# Design Update 1 — timer balance note

## Sim results (tests/sim1.mjs, 300 games, greedy 1-step player, 3 s/placement)

- Median game: **111 s (1.85 min), 37 placements, 10 lines**
- End reasons: **100% no-moves** — the timer never binds for this weak player
- p10 60 s, p90 192 s

A stronger greedy variant (hole penalty) dies at the same ~35 placements:
at 4 s/placement, 27% of games end by timeout, 73% by no-moves.

## Why this does not mean the timer is too generous

The greedy sim is a much weaker player than a human: it has no planning and
dies at ~35 placements, while the upstream balance work put the human median
at ~5.5 min (~110 placements at ~3 s/placement). The sim is only useful for
the weak-play regime, where the timer correctly does not change game length.

## Human-level estimate (analytic, using the upstream median)

- ~110 placements, ~0.3 lines/placement → ~30 lines per game
- Time bonus ≈ 30 lines × ~7 s (mostly +6 s singles, some +14 s doubles) ≈ +210 s
- Time budget ≈ 90 s start + 210 s bonus ≈ 300 s ≈ 5.0 min
- Play time at the old median ≈ 330 s

So for good players the timeout binds just before the old no-moves median:
**median game ≈ 4.5–5.5 min, plausibly inside the 4–6 min target**, with
timeout as the main ending for strong players and no-moves for weaker ones.
The specified numbers (90 s start, +6 s/line, +2 s/extra line, 120 s cap)
were NOT retuned.
