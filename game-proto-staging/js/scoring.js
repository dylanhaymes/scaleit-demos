// Scoring table (the only source of points). Shared by the game and the simulator.
// place: 1 point per cell placed
// clear: 10 per cell cleared x lines cleared at once (1 line = 80, 2 = 320, 3 = 720)
// combo: clear points x combo, where combo counts clears in a row; it survives
//        up to COMBO_GRACE placements without a clear, then resets.
// board wipe: +300
export const COMBO_GRACE = 3;
export const BOARD_CLEAR_BONUS = 300;
export function clearPoints(lines, cells, combo) { return 10 * cells * lines * Math.max(1, combo); }
