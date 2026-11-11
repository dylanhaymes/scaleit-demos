# Gridbloom — plan from prototype to the app stores

Owner of record: GOALS.md §8 (option A, fair casual puzzle game). Written 2026-11-11 by Grok.
Prototype: https://dylanhaymes.github.io/scaleit-demos/game-proto/ (source `/workspace/game/`).

## Name
- **Working name: Gridbloom.** Blocks "bloom" into petal particles when a line clears. The theme is a night garden.
- Alternatives: **Petalgrid**, **Snapgarden**, **Clearbloom**.
- Before any store listing: search the App Store, Google Play, and USPTO TESS for each name, and check that the domain or handle is free. This has not been done yet.

## What is fair and what is off the table
In the game:
- Difficulty rises by pieces placed. Everyone gets the same curve.
- A fair-deal reroll means a new tray always has at least one piece that fits.
- Comeback helper: after 2 weak games in a row, the next game gets one helper piece. It is shown in the tray (✦) and logged.
- Revives come only from a rewarded ad the player chose to watch. There is one per game and it works the same way every time: it clears the 3 fullest rows and deals a fresh tray.
- Interstitials run only at a natural break: when the player taps "Play again". Never in the first game, at most 1 in every 3 games, and at least 2 minutes apart.

Never:
- Make difficulty, pieces, or the timing of a loss depend on whether an ad is ready, what it is worth, or the player's ad history, device, or country.
- Pad scores or high scores in secret.
- Use fake close buttons, ads that start without warning during play, or rewards that are unclear.

This is enforced in code. `js/difficulty.js` never imports `js/ads.js`, and its function signatures take only the board, the number of pieces placed, and the player's local score history. The rules are shown to players under "How difficulty works".

## 1. Wrap with Capacitor (iOS + Android)
1. `npm init -y && npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`
2. `npx cap init Gridbloom com.scaleitdesigns.gridbloom --web-dir=www`. Use the bundle ID owned by whichever developer account pays; decide this before the first upload, because it can't be changed later.
3. Copy the prototype into `www/`. Drop the service worker in native builds, or guard it with `Capacitor.isNativePlatform()`.
4. `npx cap add android && npx cap add ios`. iOS needs Xcode on a Mac, or a cloud Mac CI such as Codemagic or GitHub Actions macOS runners. Android builds run on Linux, including this box.
5. Add plugins:
   - `@capacitor-community/admob` for ads.
   - `@capacitor/haptics` for a light tap when a piece is placed or a line clears.
   - `@capacitor/splash-screen`.
   - `@capacitor/status-bar`.
   - `@capacitor/app` for the back button and pausing.
6. Set portrait only. Use the icons in `icons/` as the source for a generated icon set (`@capacitor/assets`).
7. Write a Privacy Policy page (it can live on GitHub Pages) and a support email (scaleitdesigns@gmail.com or a new games inbox).
8. Test on real devices: one older Android phone, and one iPhone through TestFlight.

## 2. Costs (each needs Dylan's Pay tap; nothing has been signed up)
| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | **$99/yr** | Needed for TestFlight and the App Store. An individual account works; an organization account needs a D-U-N-S number. |
| Google Play Console | **$25 one-time** | New personal accounts must run a closed test with 12+ testers for 14 days before going to production. Plan for that. |
| AdMob | Free | Pays out by bank transfer. Needs tax info (W-9) from Dylan. |
| AdSense for Games (web build) | Free | Needs approval of a site Dylan owns. A github.io subfolder probably won't qualify, so it would need a custom domain (about $12/yr). |
| Mac for iOS builds | $0–$? | A cloud CI free tier, or a borrowed Mac. |
| Optional: domain | about $12/yr | For example gridbloom.app. Check the name first. |

No account, signup, or payment has been made. Each of these waits for Dylan.

## 3. AdMob setup checklist
1. Create the AdMob account under Dylan's Google account. **Dylan does this:** it involves tax and payment info.
2. Add two apps (Android and iOS) and link each to its store listing once it is published.
3. Create ad units:
   - `rewarded_revive` (Rewarded)
   - `interstitial_between_games` (Interstitial)
   - Optional: `banner_menu`. Leave it off at first; banners hurt how the game feels.
4. Put the App IDs in `AndroidManifest.xml` (`com.google.android.gms.ads.APPLICATION_ID`) and `Info.plist` (`GADApplicationIdentifier`).
5. Use Google's **test ad unit IDs** for all development. Add the developers' devices as test devices. **Never tap our own live ads.**
6. Consent:
   - Turn on Google's **UMP** consent message (GDPR/EEA/UK, plus the US state privacy messages).
   - On iOS, add the ATT prompt (`NSUserTrackingUsageDescription`). If the player declines, serve non-personalized ads.
7. Publish `app-ads.txt` on the developer website domain listed in the store listing.
8. Store forms:
   - Play Data safety: ads, advertising ID, and analytics, if they're added.
   - Apple privacy nutrition label.
   - Content rating questionnaires. Target a 4+/Everyone rating, and do not target children. If kids could be an audience, use Families policy and child-directed settings instead.
9. Mediation, later and optional: add AppLovin or Unity once there is volume.
10. Wire the providers: replace `MockProvider` in `js/ads.js` with the AdMob provider (sketch in that file). Keep the same `showRewarded()` and `showInterstitial()` contract.

### Policy lines to respect (Google Play, AdMob, Apple)
- **Rewarded ads must be opt-in:** clearly labeled with the reward, the player chooses to watch, and the reward is granted only when the ad completes. Our revive button says what you get.
- **No interstitials that surprise the player.** No ad when the app launches or mid-move, none right after a tap that was meant for something else, and none that block the back button. Ours appear only after "Play again".
- **No ads placed so they cause accidental clicks**, and no implying a reward for clicking an ad.
- **Play "Deceptive behavior" and Apple 5.6 / 3.1.** No dark patterns, no hidden mechanics that cheat the user, and the app must be described honestly. This is why rigged losses are out.
- **FTC (US):** no dark patterns. Any "fair play" claims in marketing must be true.
- **Privacy:** honest Data safety and nutrition labels, UMP/ATT consent, and no collecting identifiers before consent.
- **Kids:** if the game is aimed at or appealing to kids, Families/COPPA rules apply (certified ad SDKs, no personalized ads). We avoid targeting kids.

## 4. Monetization tuning plan (honest levers only)
Start state (prototype):
- One rewarded revive per game.
- Interstitial at most 1 in every 3 games, at least 2 minutes apart, and never in game 1.
- Difficulty: a level every 15 pieces.

Metrics, from the event log (`gb_events`, later Firebase or GA4):
- Day 1 / Day 7 retention.
- Games per session and session length.
- `revive_offered` → `revive_taken` rate.
- `ad_rewarded_complete` rate.
- Interstitials per session.
- Average game length.
- Share of games where the helper piece triggered.
- Store rating.

Tests to run one at a time, with a 50/50 split, 1–2 weeks each:
1. Revive offer copy and reward size: 3 rows versus a new tray only.
2. Interstitial frequency: every 3 games versus every 4 games versus time-based (3 minutes). Stop if D1 retention drops more than 2 points.
3. Difficulty curve: `LEVEL_EVERY` 15 versus 20, and the `WEIGHTS` endpoints. Goal: median game length of 4–6 minutes.
4. A second rewarded placement that players choose: "watch to reroll the tray" (opt-in, once per game).
5. Optional: a one-time "Remove ads" in-app purchase ($2.99–$4.99). Needs a Pay tap for the store's merchant setup and a tax form.

Guardrails:
- A difficulty or piece change never targets a single player based on ad value.
- Any change to the rules updates `RULES_TEXT` (shown in the game) in the same commit.

Rough economics, an assumption to validate: US rewarded eCPM is often about $10–$20 and interstitials about $5–$15. At 1,000 DAU × 2 rewarded + 2 interstitial views a day, that's roughly $30–$70/day. Real numbers depend on country mix and fill rates. Growth (UA or organic Shorts) is the real constraint.

## 5. Suggested owner
**Recommendation: a new "Games" bot.** It owns build, store listings, AdMob, and the weekly metrics review. Muse produces the gameplay Shorts and Reels for marketing.

The fallback is **Pulse**, since it already builds and ships web products and works through Scale It's GitHub. The risk is that it pulls focus from Pulse AI Desk, which is the priority in GOALS.md §1.

Either way, Grok approves releases, and Dylan taps Pay for Apple, Google, and any domain.

## 6. Next steps
1. Dylan plays the prototype on his phone and gives feedback on how it feels.
2. Pick a name (run the trademark and store search), and pick the owner: Games bot or Pulse.
3. Polish:
   - Haptics.
   - Background music toggle.
   - Daily-challenge seed.
   - A tutorial hand on the first game.
   - Save a game in progress on app close.
4. Capacitor wrap → an Android debug APK built on the box → sideload test.
5. Dylan's Pay taps: Google Play $25, then Apple $99. Then the AdMob account and tax info.
6. Closed test on Play (12 testers × 14 days) and TestFlight. Then production.
