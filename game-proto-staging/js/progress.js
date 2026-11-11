// Lifetime player level (Design Update 5). Cosmetics ONLY — it never
// changes difficulty, piece selection, or loss timing for any player.
// XP: 10 per line cleared, 5 per max combo in the game, 25 per game played.
// Level thresholds are cumulative XP: level L needs 50*L*(L+1) total XP
// (L1 = 100, L2 = 300, L3 = 600, L4 = 1000, L5 = 1500, ...). Milestone
// rewards are cosmetic unlocks stored locally (sticker packs, block skins,
// board frames, backgrounds). No randomness: the reward at each level is
// fixed and listed below. Nothing here is sold, ad-gated, or random.
export const XP_PER_LINE = 10;
export const XP_PER_COMBO = 5;
export const XP_PER_GAME = 25;

export const MILESTONES = [
  { level: 2, reward: 'Gold Star sticker pack' },
  { level: 3, reward: 'Crayon Red block skin' },
  { level: 4, reward: 'Sunny Day board frame' },
  { level: 5, reward: 'Rainbow block skin' },
  { level: 7, reward: 'Chalk Doodle background' },
  { level: 10, reward: 'Golden Trophy board frame' },
  { level: 15, reward: 'Superstar sticker pack' },
  { level: 20, reward: 'Rainbow Trophy board frame' },
];

export function xpForGame(lines, maxCombo) {
  return lines * XP_PER_LINE + maxCombo * XP_PER_COMBO + XP_PER_GAME;
}
export function xpNeededForLevel(level) { return 50 * level * (level + 1); }
export function playerLevelFor(xp) {
  let level = 1;
  while (xp >= xpNeededForLevel(level)) level++;
  return level;
}
// { level, xpIntoLevel, xpForNext } — progress within the current level.
export function playerProgress(xp) {
  const level = playerLevelFor(xp);
  const prev = level <= 1 ? 0 : xpNeededForLevel(level - 1);
  const next = xpNeededForLevel(level);
  return { level, xpIntoLevel: xp - prev, xpForNext: next - prev };
}
export function nextReward(level) {
  return MILESTONES.find((m) => m.level >= level) || null;
}
export function rewardsForLevel(level) {
  return MILESTONES.filter((m) => m.level <= level).map((m) => m.reward);
}
