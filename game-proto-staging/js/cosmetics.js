// Clearbloom cosmetics — the 10 skin packs (Design Update 5, polish item 5).
//
// The pack library was proposed Nov 11 (sheets + in-game mocks under
// design5/skins/) and built in-game Nov 12 on Dylan's word. Each pack is
// the same 37 piece shapes in 7 colors with a different material + palette
// — cosmetics ONLY: never difficulty, piece bag, scoring, timer, power-ups,
// ads, or loss timing. Packs are applied by re-rendering the block sprites
// (js/sprites.js) in the pack's palette + material; pieces keep their
// colour SLOT (0-6), so switching packs recolors the live board by slot.
//
// Unlocks are evaluated against REAL state only. The old progress.js
// MILESTONES named rewards that did not exist ("Crayon Red block skin",
// "Sunny Day board frame", ...) and the game-over line told players they
// had unlocked them — that false-unlock claim is the bug this module
// fixes: isPackUnlocked() only ever returns true for a pack that exists
// AND whose requirement is actually met, and rewardsForLevel() only ever
// names packs from this registry.
//
// Paid packs ($1.99 / Supporter $5.99) stay locked in v1: the store is
// TEST-only (js/store.js), buy() always refuses, so `owned` can only grow
// when real billing lands. Nothing here can charge anyone.
// Daily missions do not exist yet (Update 4), so missionStars() is 0 and
// Construction Paper is honestly locked with "coming soon" until they do.
import { playerLevelFor } from './progress.js';

export const PACKS = [
  {
    slug: 'classic-candy', name: 'Classic Candy', badge: 'STARTING SKIN',
    unlock: { kind: 'included' },
    unlockText: 'Included from the start',
    material: 'candy',
    note: 'The current default — glossy 3D candy blocks, saturated crayon colors.',
    colors: ['#ff4d4d', '#ff8a1e', '#ffd21f', '#2fd65a', '#2f8cff', '#9b4dff', '#ff5da2'],
    colorNames: ['Cherry', 'Orange', 'Lemon', 'Lime', 'Berry', 'Grape', 'Bubblegum'],
  },
  {
    slug: 'gold-star', name: 'Gold Star Stickers', badge: 'PLAYER LEVEL 2',
    unlock: { kind: 'level', level: 2 },
    unlockText: 'Player Level 2',
    material: 'sticker',
    note: 'Sticker-like blocks with a gold-star motif on every block, still 3D and glossy.',
    colors: ['#ff5252', '#ff9e1b', '#ffc700', '#33cc5e', '#2f8cff', '#a55eff', '#ff5da2'],
    colorNames: ['Cherry', 'Marigold', 'Gold', 'Clover', 'Berry', 'Grape', 'Bubblegum'],
  },
  {
    slug: 'crayon-box', name: 'Crayon Box', badge: 'PLAYER LEVEL 5',
    unlock: { kind: 'level', level: 5 },
    unlockText: 'Player Level 5',
    material: 'crayon',
    note: 'Waxy crayon material with a paper wrapper band, saturated classroom-crayon colors.',
    colors: ['#e63946', '#f77f00', '#fcbf49', '#2a9d8f', '#277da1', '#7b2cbf', '#ef476f'],
    colorNames: ['Cherry', 'Pumpkin', 'Sunshine', 'Teal', 'Denim', 'Grape', 'Watermelon'],
  },
  {
    slug: 'construction-paper', name: 'Construction Paper', badge: '15 MISSION STARS',
    unlock: { kind: 'stars', stars: 15 },
    unlockText: '15 mission stars',
    material: 'paper',
    note: 'Stacked cut-paper edges and rich craft-paper colors, still dimensional.',
    colors: ['#d92b2b', '#ef7d1a', '#f5b301', '#1faa59', '#1f6fd6', '#8a3fd1', '#ef3d8a'],
    colorNames: ['Brick', 'Tangerine', 'Mustard', 'Leaf', 'Cobalt', 'Plum', 'Magenta'],
  },
  {
    slug: 'gummy-garden', name: 'Gummy Garden', badge: 'PLAYER LEVEL 12',
    unlock: { kind: 'level', level: 12 },
    unlockText: 'Player Level 12',
    material: 'gummy',
    note: 'Translucent gummy florals and leaves — soft glow, tiny blossom on every block.',
    colors: ['#ff5d8f', '#ff9f43', '#ffd32a', '#3ecf6e', '#2bb3a3', '#7b5cff', '#ff6b6b'],
    colorNames: ['Rose', 'Peach', 'Pollen', 'Sprout', 'Mint', 'Lavender', 'Coral'],
  },
  {
    slug: 'midnight-galaxy', name: 'Midnight Galaxy', badge: 'PLAYER LEVEL 20',
    unlock: { kind: 'level', level: 20 },
    unlockText: 'Player Level 20',
    material: 'galaxy',
    note: 'Deep saturated night colors with star highlights — toy-glossy, never grim.',
    colors: ['#ff4d6d', '#ff8a3d', '#ffd21f', '#2fd65a', '#3d7bff', '#b45cff', '#ff5da2'],
    colorNames: ['Nova', 'Comet', 'Stardust', 'Aurora', 'Nebula', 'Pulsar', 'Cosmos'],
  },
  {
    slug: 'ocean-gummies', name: 'Ocean Gummies', badge: '$1.99',
    unlock: { kind: 'iap', price: '$1.99', product: 'cosmetic_pack' },
    unlockText: '$1.99',
    material: 'ocean',
    note: 'Sea-glass and gummy ocean hues — translucent aqua with rising bubbles.',
    colors: ['#00b4d8', '#0096c7', '#48cae4', '#06d6a0', '#3a86ff', '#7209b7', '#ff70a6'],
    colorNames: ['Lagoon', 'Deep Sea', 'Foam', 'Seafoam', 'Current', 'Abyss', 'Coral'],
  },
  {
    slug: 'sunshine-citrus', name: 'Sunshine Citrus', badge: '$1.99',
    unlock: { kind: 'iap', price: '$1.99', product: 'cosmetic_pack' },
    unlockText: '$1.99',
    material: 'citrus',
    note: 'Lemon, lime and orange hard candy — extra-sharp shine, the sunniest pack in the set.',
    colors: ['#ffe11f', '#ffc21f', '#ff8a1e', '#ff5e2b', '#b5e61d', '#2fd65a', '#ff5da2'],
    colorNames: ['Lemon', 'Yuzu', 'Orange', 'Blood Orange', 'Lime', 'Key Lime', 'Dragonfruit'],
  },
  {
    slug: 'frosted-winter', name: 'Frosted Winter', badge: '$1.99',
    unlock: { kind: 'iap', price: '$1.99', product: 'cosmetic_pack' },
    unlockText: '$1.99',
    material: 'frosted',
    note: 'Icy gloss in cool saturated mint and snow — cheerful sparkle, never dull.',
    colors: ['#38bdf8', '#0ea5e9', '#6366f1', '#2dd4bf', '#34d399', '#a78bfa', '#f472b6'],
    colorNames: ['Glacier', 'Ice Blue', 'Frost', 'Mint', 'Spruce', 'Snowberry', 'Cranberry'],
  },
  {
    slug: 'lollipop-swirl', name: 'Lollipop Swirl', badge: 'SUPPORTER EXCLUSIVE',
    unlock: { kind: 'supporter', price: '$5.99', product: 'supporter' },
    unlockText: 'Supporter Bundle $5.99',
    material: 'swirl',
    note: 'Rainbow lollipop swirl on every block — the sweet-shop showpiece, bundle-only.',
    colors: ['#ff4d4d', '#ff8a1e', '#ffd21f', '#2fd65a', '#2f8cff', '#9b4dff', '#ff5da2'],
    colorNames: ['Cherry', 'Orange', 'Lemon', 'Lime', 'Berry', 'Grape', 'Bubblegum'],
  },
];

export const DEFAULT_PACK = 'classic-candy';
const STORE_KEY = 'gb_cosmetics';

export function packBySlug(slug) {
  return PACKS.find((p) => p.slug === slug) || null;
}

// Daily missions do not exist yet (Update 4, queued for the closed test),
// so nobody has mission stars. Returning 0 keeps Construction Paper
// honestly locked until missions land — never a fake unlock.
export function missionStars() { return 0; }

// Unlock context: { playerLevel, missionStars, owned } — owned is an
// array/Set of pack slugs (iap) or 'supporter' for the bundle.
export function isPackUnlocked(slug, ctx) {
  const pack = packBySlug(slug);
  if (!pack) return false; // unknown slug: never unlocked, never claimable
  const owned = ctx && ctx.owned ? new Set(ctx.owned) : new Set();
  const level = ctx && ctx.playerLevel != null ? ctx.playerLevel : 1;
  const stars = ctx && ctx.missionStars != null ? ctx.missionStars : 0;
  switch (pack.unlock.kind) {
    case 'included': return true;
    case 'level': return level >= pack.unlock.level;
    case 'stars': return stars >= pack.unlock.stars;
    case 'iap': return owned.has(slug);
    case 'supporter': return owned.has('supporter');
    default: return false;
  }
}

// Honest lock text for the picker: what it takes, plus "coming soon"
// where the path does not exist yet (missions).
export function lockText(pack) {
  if (!pack) return '';
  switch (pack.unlock.kind) {
    case 'included': return 'Included from the start';
    case 'level': return `Unlocks at Player Level ${pack.unlock.level}`;
    case 'stars': return 'Unlocks with 15 mission stars · Daily missions coming soon';
    case 'iap': return `${pack.unlock.price} · Not for sale yet (test build)`;
    case 'supporter': return `Supporter Bundle ${pack.unlock.price} · Not for sale yet (test build)`;
    default: return '';
  }
}

// Level milestones that actually exist, for progress.js: the packs a
// player level unlocks, in level order. Construction Paper is a mission
// reward, not a level reward, so it is not a milestone.
export function levelMilestones() {
  return PACKS.filter((p) => p.unlock.kind === 'level')
    .map((p) => ({ level: p.unlock.level, reward: p.name, pack: p.slug }))
    .sort((a, b) => a.level - b.level);
}

// ---- Local state (per device, guests and signed-in alike for v1) ----
export function loadCosmetics() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {};
    const selected = packBySlug(d.selected) ? d.selected : DEFAULT_PACK;
    const favorites = Array.isArray(d.favorites) ? d.favorites.filter((s) => packBySlug(s)) : [];
    const owned = Array.isArray(d.owned) ? d.owned.filter((s) => s === 'supporter' || packBySlug(s)) : [];
    return { selected, favorites, owned };
  } catch { return { selected: DEFAULT_PACK, favorites: [], owned: [] }; }
}
function saveCosmetics(state) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}
export function selectedPack() { return loadCosmetics().selected; }
export function setSelectedPack(slug) {
  if (!packBySlug(slug)) return false;
  const st = loadCosmetics(); st.selected = slug; saveCosmetics(st); return true;
}
// Favorites are quick access, not ownership: only a pack the player
// actually owns/unlocked can be favorited. A locked pack is a goal, not
// a favorite — starring it would promise quick access to something the
// player cannot use yet.
export function toggleFavorite(slug, ctx) {
  if (!packBySlug(slug) || !isPackUnlocked(slug, ctx)) return { ok: false, reason: 'locked' };
  const st = loadCosmetics();
  const i = st.favorites.indexOf(slug);
  if (i >= 0) st.favorites.splice(i, 1); else st.favorites.push(slug);
  saveCosmetics(st);
  return { ok: true, favorited: i < 0 };
}
export function favorites() { return loadCosmetics().favorites; }

// Recolor one board/tray hex by colour SLOT when the pack changes: the
// hex's index in the old palette becomes the same index in the new one.
// Hexes that belong to no palette (tutorial colours, test blues, white)
// are left alone — Sprites renders them on demand in the new material.
export function recolorHex(hex, fromPal, toPal) {
  if (!hex || !fromPal || !toPal) return hex;
  const i = fromPal.indexOf(hex);
  return i >= 0 && i < toPal.length ? toPal[i] : hex;
}

// Full unlock context from local state (single call site for the UI).
export function unlockContext(xp) {
  const st = loadCosmetics();
  return { playerLevel: playerLevelFor(xp || 0), missionStars: missionStars(), owned: st.owned };
}
