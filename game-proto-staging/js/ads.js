// Ad adapter. Game code only ever calls Ads.showInterstitial().
// Today the provider is a mock overlay. Later, call Ads.setProvider(...) with an
// AdMob (Capacitor) or AdSense for Games (H5 adBreak) provider. See PLAN.md.
//
// IMPORTANT (fairness): nothing in this file is imported by difficulty.js, and
// difficulty never receives ad readiness, ad history, or ad value. Ads cannot
// change the board, the pieces, or the score.
import { Analytics } from './analytics.js';

const $ = (id) => document.getElementById(id);

// ---- Mock provider (default) ----
const MockProvider = {
  name: 'mock',
  async init() {},
  _show(seconds) {
    return new Promise((resolve) => {
      const ov = $('ad'), cnt = $('ad-count'), close = $('ad-close');
      let left = seconds;
      cnt.textContent = left;
      close.textContent = 'Skip';
      close.disabled = true;
      ov.classList.add('show');
      const tick = setInterval(() => {
        left--;
        cnt.textContent = Math.max(0, left);
        if (left <= seconds - 2) close.disabled = false;
        if (left <= 0) {
          clearInterval(tick);
          cnt.textContent = '✓';
          close.disabled = false;
          close.textContent = 'Close';
        }
      }, 1000);
      close.onclick = () => {
        clearInterval(tick);
        ov.classList.remove('show');
        resolve({ shown: true });
      };
    });
  },
  showInterstitial() { return this._show(this.interstitialSeconds); },
  interstitialSeconds: 3,
};

/* ---- AdSense for Games (H5) provider sketch, for the web build ----
   <script async data-ad-client="ca-pub-XXXX" data-adbreak-test="on"
     src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
   window.adsbygoogle = window.adsbygoogle || [];
   const adBreak = (o) => adsbygoogle.push(o);
   export const H5Provider = {
     name: 'h5',
     init() { adBreak({ preloadAdBreaks: 'on', sound: 'on' }); },
     showInterstitial(placement) { return new Promise((res) => {
       adBreak({ type: 'next', name: placement, adBreakDone: (i) => res({ shown: i.breakStatus === 'viewed' }) });
     }); },
   };
   ---- AdMob provider sketch, for the Capacitor build ----
   import { AdMob, RewardAdPluginEvents } from '@capacitor-community/admob';
   showInterstitial: await AdMob.prepareInterstitial({ adId }); await AdMob.showInterstitial(); return { shown: true };
*/

// ---- Interstitial pacing (game end only — Dylan, Nov 12) ----
// Shown when a game ends, before the game-over panel: a 1-in-INTERSTITIAL_EVERY
// random roll at each game end (never tied to score, performance or any
// player state), never after the first game of a session, and never within
// INTERSTITIAL_MIN_GAP_MS of the last one. Never during play. The roll is
// the only selection mechanism — the old every-Nth-game counter is gone.
export const INTERSTITIAL_EVERY = 3;
export const INTERSTITIAL_MIN_GAP_MS = 120000;

export const Ads = {
  provider: MockProvider,
  _lastInterstitial: 0,
  setProvider(p) { this.provider = p; return p.init && p.init(); },
  init() { return this.provider.init(); },
  async showInterstitial(placement = 'game_end') {
    Analytics.log('interstitial_shown', { placement, provider: this.provider.name });
    const r = await this.provider.showInterstitial(placement);
    this._lastInterstitial = Date.now();
    return r;
  },
  // Call when a game ends, before the game-over panel. Returns true if an ad
  // ran. Selection is a random 1-in-INTERSTITIAL_EVERY roll — nothing about
  // the game just played (score, lines, mode) may influence it. Guards: never
  // after the first game of a session, never within INTERSTITIAL_MIN_GAP_MS
  // of the last interstitial.
  async maybeInterstitialAtGameEnd(gamesPlayedThisSession) {
    if (gamesPlayedThisSession <= 1) return false;
    if (this._lastInterstitial && Date.now() - this._lastInterstitial < INTERSTITIAL_MIN_GAP_MS) return false;
    if (Math.random() >= 1 / INTERSTITIAL_EVERY) return false;
    await this.showInterstitial('game_end');
    return true;
  },
};
