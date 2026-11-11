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

export const PALETTE = ['#ff6b8b', '#ffb347', '#a3e36b', '#3fd8c8', '#5aa2ff', '#a879ff', '#ff79d0'];

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
  return { shape, color: PALETTE[Math.floor(rng() * PALETTE.length)], helper: false };
}
