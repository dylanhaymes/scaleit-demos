// Seeded PRNG for the daily challenge. mulberry32: tiny, fast, deterministic.
// The seed comes only from the local calendar date (YYYY-MM-DD), so everyone
// playing on the same date gets the same deal sequence for the same moves.
export function hashSeed(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function makeRng(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.getState = () => a;
  rng.setState = (s) => { a = s >>> 0; };
  return rng;
}
export function localDateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function dailyRng(dateKey = localDateKey()) { return makeRng(hashSeed('gridbloom-daily-' + dateKey)); }
