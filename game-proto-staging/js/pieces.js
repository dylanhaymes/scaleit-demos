// Piece shapes. '#' = filled. Each shape has a size class used by difficulty.js.
const RAW = {
  tiny: ['#', '##', '#\n#'],
  small: ['###', '#\n#\n#', '##\n#.', '##\n.#', '#.\n##', '.#\n##'],
  mid: [
    '####', '#\n#\n#\n#', '##\n##',
    '###\n.#.', '.#.\n###', '#.\n##\n#.', '.#\n##\n.#',
    '#..\n###', '..#\n###', '###\n#..', '###\n..#',
    '##\n#.\n#.', '##\n.#\n.#', '#.\n#.\n##', '.#\n.#\n##',
    '##.\n.##', '.##\n##.', '#.\n##\n.#', '.#\n##\n#.',
  ],
  big: [
    '#####', '#\n#\n#\n#\n#',
    '###\n#..\n#..', '###\n..#\n..#', '#..\n#..\n###', '..#\n..#\n###',
    '###\n###', '##\n##\n##',
  ],
  huge: ['###\n###\n###'],
};

// Crayon palette: saturated, bright classroom colours (Classic Candy).
export const PALETTE = ['#ff4d4d', '#ff8a1e', '#ffd21f', '#2fd65a', '#2f8cff', '#9b4dff', '#ff5da2'];

// Active palette: the equipped pack's 7 colours. dealTray/makePiece draw
// from here, so new pieces always arrive in the equipped pack. Defaults
// to the classic candy palette (PALETTE); Cosmetics.applyPack swaps it.
let ACTIVE_PALETTE = PALETTE;
export function setActivePalette(colors) {
  if (Array.isArray(colors) && colors.length === 7) ACTIVE_PALETTE = colors;
}
export function activePalette() { return ACTIVE_PALETTE; }

function parse(str) {
  const cells = [];
  str.split('\n').forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') cells.push([r, c]); }));
  const h = Math.max(...cells.map((x) => x[0])) + 1;
  const w = Math.max(...cells.map((x) => x[1])) + 1;
  return { cells, w, h };
}

export const SHAPES = [];
for (const [cls, list] of Object.entries(RAW)) for (const s of list) SHAPES.push({ id: SHAPES.length, cls, ...parse(s) });

export function makePiece(shape, rng = Math.random) {
  return { shape, color: ACTIVE_PALETTE[Math.floor(rng() * ACTIVE_PALETTE.length)], helper: false };
}
