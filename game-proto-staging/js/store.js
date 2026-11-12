// Store UI — TEST products only (Update 3, batch 4).
//
// The store shows the three planned products with their real intended
// prices, but NOTHING here can be bought: there is no billing wired up in
// v1 (no Capacitor billing, no Play listing), so every product is labelled
// TEST and every buy/restore tap answers honestly that purchases are not
// live yet. No network call, no checkout flow, no charge — ever.
// When real billing lands, this module is the seam: buy() becomes the
// billing call and the TEST labels come off. Until then, the labels stay.
//
// NO paid power-ups, NO paid continues, NO loot boxes, NO streak restores.
// Ever. The store sells only: ad removal, cosmetics, and a supporter
// bundle. Power-ups are earned only, through play.
export const TEST_PRODUCTS = [
  {
    id: 'remove_ads',
    name: 'Remove Ads',
    price: '$3.99',
    blurb: 'No more interstitial ads. Forever.',
  },
  {
    id: 'cosmetic_pack',
    name: 'Cosmetic Pack',
    price: '$1.99',
    blurb: 'A set of board + tray skins. Cosmetics only — never gameplay.',
  },
  {
    id: 'supporter',
    name: 'Supporter Bundle',
    price: '$5.99',
    blurb: 'Remove Ads + Cosmetic Pack + a supporter badge. Thanks for playing!',
  },
];

export const Store = {
  products() {
    return TEST_PRODUCTS.map((p) => ({ ...p }));
  },

  // Test-only: always refuses, truthfully. Never calls any billing API.
  buy(productId) {
    const p = TEST_PRODUCTS.find((x) => x.id === productId);
    if (!p) return { ok: false, reason: 'bad-product' };
    return { ok: false, reason: 'test-only', product: p.id };
  },

  // Test-only: there are no real purchases to restore yet.
  restore() {
    return { ok: false, reason: 'test-only' };
  },
};
