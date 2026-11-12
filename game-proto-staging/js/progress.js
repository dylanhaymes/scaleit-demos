// Lifetime player level (Design Update 5). Cosmetics ONLY — it never
// changes difficulty, piece selection, or loss timing for any player.
// XP: 10 per line cleared, 5 per max combo in the game, 25 per game played.
// Level thresholds are cumulative XP: level L needs 50*L*(L+1) total XP
// (L1 = 100, L2 = 300, L3 = 600, L4 = 1000, L5 = 1500, ...). Milestone
// rewards are REAL cosmetic packs from js/cosmetics.js — nothing else.
// The old list named rewards that did not exist ("Crayon Red block skin",
// "Sunny Day board frame", "Rainbow block skin", "Chalk Doodle background",
// "Golden Trophy board frame", "Superstar sticker pack", "Rainbow Trophy
// board frame") and the game-over line told players they had unlocked
// them. That false-unlock claim is fixed by listing only packs that
// exist: the four level packs. Construction Paper is a mission reward
// (15 mission stars), not a level reward, so it is not a milestone.
// Nothing here is sold, ad-gated, or random.
export const XP_PER_LINE = 10;
export const XP_PER_COMBO = 5;
export const XP_PER_GAME = 25;

export const MILESTONES = [
  { level: 2, reward: 'Gold Star Stickers', pack: 'gold-star' },
  { level: 5, reward: 'Crayon Box', pack: 'crayon-box' },
  { level: 12, reward: 'Gummy Garden', pack: 'gummy-garden' },
  { level: 20, reward: 'Midnight Galaxy', pack: 'midnight-galaxy' },
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
