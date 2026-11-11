// Ad adapter. Game code only ever calls Ads.showRewarded() / Ads.showInterstitial().
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
  isRewardedReady() { return true; },
  _show(kind, seconds) {
    return new Promise((resolve) => {
      const ov = $('ad'), cnt = $('ad-count'), close = $('ad-close');
      let left = seconds, done = false;
      cnt.textContent = left;
      close.textContent = kind === 'rewarded' ? 'Close (no reward)' : 'Skip';
      close.disabled = kind === 'interstitial';
      ov.classList.add('show');
      const tick = setInterval(() => {
        left--;
        cnt.textContent = Math.max(0, left);
        if (kind === 'interstitial' && left <= seconds - 2) close.disabled = false;
        if (left <= 0) {
          clearInterval(tick);
          done = true;
          cnt.textContent = '✓';
          close.disabled = false;
          close.textContent = kind === 'rewarded' ? 'Collect reward' : 'Close';
        }
      }, 1000);
      close.onclick = () => {
        clearInterval(tick);
        ov.classList.remove('show');
        resolve(kind === 'rewarded' ? { rewarded: done } : { shown: true });
      };
    });
  },
  showRewarded() { return this._show('rewarded', this.rewardedSeconds); },
  showInterstitial() { return this._show('interstitial', this.interstitialSeconds); },
  rewardedSeconds: 5,
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
     isRewardedReady() { return true; },  // H5 tells us via beforeReward
     showRewarded(placement) { return new Promise((res) => {
       let rewarded = false, offered = false;
       adBreak({ type: 'reward', name: placement,
         beforeReward: (showAdFn) => { offered = true; showAdFn(); },
         adViewed: () => { rewarded = true; },
         adDismissed: () => { rewarded = false; },
         adBreakDone: () => res({ rewarded: offered && rewarded }) });
     }); },
     showInterstitial(placement) { return new Promise((res) => {
       adBreak({ type: 'next', name: placement, adBreakDone: (i) => res({ shown: i.breakStatus === 'viewed' }) });
     }); },
   };
   ---- AdMob provider sketch, for the Capacitor build ----
   import { AdMob, RewardAdPluginEvents } from '@capacitor-community/admob';
   showRewarded: await AdMob.prepareRewardVideoAd({ adId }); const r = await AdMob.showRewardVideoAd(); return { rewarded: !!r };
   showInterstitial: await AdMob.prepareInterstitial({ adId }); await AdMob.showInterstitial(); return { shown: true };
*/

// ---- Interstitial pacing (natural breaks only) ----
// Shown only when the player starts a new game from the game-over screen,
// never during play, never in the first game of a session, at most once every
// INTERSTITIAL_EVERY games and never within INTERSTITIAL_MIN_GAP_MS of the last one.
export const INTERSTITIAL_EVERY = 3;
export const INTERSTITIAL_MIN_GAP_MS = 120000;

export const Ads = {
  provider: MockProvider,
  _gamesSince: 0,
  _lastInterstitial: 0,
  setProvider(p) { this.provider = p; return p.init && p.init(); },
  init() { return this.provider.init(); },
  isRewardedReady() { return this.provider.isRewardedReady(); }, // used ONLY to decide if the revive button is shown
  async showRewarded(placement = 'revive') {
    Analytics.log('ad_rewarded_start', { placement, provider: this.provider.name });
    const r = await this.provider.showRewarded(placement);
    Analytics.log(r.rewarded ? 'ad_rewarded_complete' : 'ad_rewarded_skipped', { placement });
    return r;
  },
  async showInterstitial(placement = 'between_games') {
    Analytics.log('interstitial_shown', { placement, provider: this.provider.name });
    const r = await this.provider.showInterstitial(placement);
    this._lastInterstitial = Date.now();
    this._gamesSince = 0;
    return r;
  },
  // Call at a natural break (player tapped "Play again"). Returns true if an ad ran.
  async maybeInterstitialAtBreak(gamesPlayedThisSession) {
    this._gamesSince++;
    if (gamesPlayedThisSession < 1) return false;
    if (this._gamesSince < INTERSTITIAL_EVERY) return false;
    if (Date.now() - this._lastInterstitial < INTERSTITIAL_MIN_GAP_MS && this._lastInterstitial) return false;
    await this.showInterstitial('between_games');
    return true;
  },
};
