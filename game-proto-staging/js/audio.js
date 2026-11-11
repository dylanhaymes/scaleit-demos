// All sounds are synthesized with WebAudio (no audio assets).
let ctx = null, master = null;
// SFX on by default (legacy gb_muted honored). Music ON by default for
// first-run players: no gb_music key yet means on. A player who previously
// turned music off (gb_music === '0') stays off.
let muted = localStorage.getItem('gb_sfx') ? localStorage.getItem('gb_sfx') === '0' : localStorage.getItem('gb_muted') === '1';
let musicOn = localStorage.getItem('gb_music') !== '0';
let musicBus = null, urgencyBus = null, schedTimer = null, duckTimer = null;
let schedStart = 0, schedNextEighth = 0, urgencyOn = false;

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', vol = 0.3, delay = 0, slide = 0, attack = 0.005 } = {}) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.2, delay = 0, hp = 1200) {
  if (muted) return;
  const c = ac(); if (!c) return;
  const t = c.currentTime + delay;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = c.createGain(); g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(master); s.start(t);
}

const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1568, 1760];

export const Sfx = {
  unlock() { ac(); if (musicOn) Music.start(); },
  get muted() { return muted; },
  setOn(on) { muted = !on; localStorage.setItem('gb_sfx', on ? '1' : '0'); return !muted; },
  toggle() { this.setOn(muted); return muted; },
  pick() { tone(660, 0.07, { type: 'triangle', vol: 0.15, slide: 1.4 }); },
  place() { tone(180, 0.12, { type: 'sine', vol: 0.4, slide: 0.6 }); noise(0.05, 0.08, 0, 2500); },
  invalid() { tone(220, 0.1, { type: 'square', vol: 0.06, slide: 0.8 }); },
  clear(lines, combo) {
    Music.duck();
    const base = Math.min(combo, 5);
    const n = 3 + lines;
    for (let i = 0; i < n; i++) tone(PENTA[Math.min(PENTA.length - 1, base + i)], 0.22, { type: 'triangle', vol: 0.22, delay: i * 0.055 });
    noise(0.25, 0.1, 0.02, 4000);
    if (lines >= 2) tone(130.8, 0.5, { type: 'sine', vol: 0.35, slide: 0.5 });
  },
  combo(c) { Music.duck(); tone(PENTA[Math.min(9, c + 2)], 0.3, { type: 'sawtooth', vol: 0.08, delay: 0.2 }); },
  boardClear() { [0, 4, 7, 12].forEach((s, i) => tone(523.25 * Math.pow(2, s / 12), 0.5, { type: 'triangle', vol: 0.2, delay: i * 0.08 })); },
  over() { [392, 349.2, 311.1, 261.6].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.2, delay: i * 0.16 })); },
  revive() { [261.6, 392, 523.25, 784].forEach((f, i) => tone(f, 0.25, { type: 'sine', vol: 0.25, delay: i * 0.07 })); },
  best() { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.18, delay: i * 0.09 })); },
  // Gentle countdown tick: pitch rises a little in the last 5 s.
  tick(secsLeft) {
    const f = secsLeft <= 5 ? 880 + (5 - secsLeft) * 60 : 660;
    tone(f, 0.08, { type: 'triangle', vol: 0.14 });
  },
  // Power-up earned: bright little chime.
  powerup() { [784, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.2, delay: i * 0.07 })); },
  // Level-up fanfare.
  levelUp() { [523.25, 659.25, 783.99, 1046.5, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.22, delay: i * 0.09 })); },
};

// ---- Music: an original, bouncy, upbeat classroom track, synthesized ----
// (no audio assets, no third-party music — see CREDITS.md). 120 BPM, marimba
// plucks + light claps + simple mid-range bass + a playful pentatonic melody.
// The whole track is ONE deterministic 96-second loop (48 bars, 192 beats):
// the event list is built once from a fixed seed, and the scheduler plays it
// on an absolute beat grid that never resets — so the seam is clean by
// construction (every note ends before the loop boundary, and the pattern
// repeats identically). Melody stays mid-range (392–659 Hz, centred 392–
// 523 Hz), below most SFX chime energy (659–1760 Hz), so it does not collide
// with the clear/combo sounds. Quiet by default; ducks under SFX; pauses
// when the app is hidden. In the timer's last 20 s, a light shaker layer
// fades in on every eighth note (same tempo — no speed-up, just urgency).
export const BPM = 120;
const BEAT = 60 / BPM; // 0.5 s
const EIGHTH = BEAT / 2; // 0.25 s
const LOOP_BEATS = 192; // 96 s loop
const LOOP_SECONDS = LOOP_BEATS * BEAT;
const CHORD_SEQ = ['C', 'Am', 'F', 'G']; // one chord per 4 bars, cycling
const CHORD_ROOT = { C: 130.81, Am: 110.0, F: 174.61, G: 196.0 };
const MEL = [392.0, 440.0, 523.25, 587.33, 659.25]; // C pentatonic, mid-range

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Build the loop once: 384 eighth-note slots, each a list of note events.
function buildLoop() {
  const rng = mulberry32(20261111);
  const slots = Array.from({ length: LOOP_BEATS * 2 }, () => []);
  let melIdx = 2;
  for (let bar = 0; bar < 48; bar++) {
    const root = CHORD_ROOT[CHORD_SEQ[Math.floor(bar / 4) % 4]];
    // Bass: beats 1 and 3, plus a fifth on the last beat of every 4th bar.
    slots[bar * 8].push({ kind: 'bass', freq: root, dur: 0.45, vol: 0.5 });
    slots[bar * 8 + 4].push({ kind: 'bass', freq: root, dur: 0.45, vol: 0.42 });
    if (bar % 4 === 3) slots[bar * 8 + 6].push({ kind: 'bass', freq: root * 1.5, dur: 0.3, vol: 0.3 });
    // Light claps: beats 2 and 4.
    slots[bar * 8 + 2].push({ kind: 'clap', dur: 0.08, vol: 0.05 });
    slots[bar * 8 + 6].push({ kind: 'clap', dur: 0.08, vol: 0.05 });
    // Playful melody: random walk, ~62% of eighths.
    for (let e = 0; e < 8; e++) {
      if (rng() < 0.62) {
        melIdx += Math.floor(rng() * 5) - 2;
        melIdx = Math.max(0, Math.min(MEL.length - 1, melIdx));
        slots[bar * 8 + e].push({ kind: 'pluck', freq: MEL[melIdx], dur: 0.32, vol: 0.3 });
      }
    }
  }
  return slots;
}
const LOOP = buildLoop();

function envGain(t, vol, dur, attack = 0.004) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
}
function pluck(freq, t, dur, vol) {
  // Marimba: sine fundamental + a quiet 4th harmonic, fast decay.
  const g = envGain(t, vol, dur);
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 4.02;
  const g2 = ctx.createGain(); g2.gain.value = 0.12;
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(musicBus);
  o.start(t); o.stop(t + dur + 0.02); o2.start(t); o2.stop(t + dur + 0.02);
}
function bassNote(freq, t, dur, vol) {
  const g = envGain(t, vol, dur, 0.01);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq / 2;
  const g2 = ctx.createGain(); g2.gain.value = 0.5;
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(musicBus);
  o.start(t); o.stop(t + dur + 0.02); o2.start(t); o2.stop(t + dur + 0.02);
}
function noiseHit(t, dur, vol, type, freq, q = 1) {
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(musicBus);
  s.start(t);
}
function shakerTick(t) {
  // Urgency-layer tick: short bright shaker, routed through the urgency bus
  // (whose gain fades in/out), on every eighth note while the timer is low.
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * 0.05)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
  const g = ctx.createGain(); g.gain.value = 0.12;
  s.connect(f); f.connect(g); g.connect(urgencyBus);
  s.start(t);
}
function scheduleEighth(n, t) {
  for (const ev of LOOP[n % LOOP.length]) {
    if (ev.kind === 'pluck') pluck(ev.freq, t, ev.dur, ev.vol);
    else if (ev.kind === 'bass') bassNote(ev.freq, t, ev.dur, ev.vol);
    else if (ev.kind === 'clap') noiseHit(t, ev.dur, ev.vol, 'bandpass', 1600, 1);
  }
  if (urgencyOn) shakerTick(t);
}

export const Music = {
  get on() { return musicOn; },
  get bpm() { return BPM; },
  get loopSeconds() { return LOOP_SECONDS; },
  get urgency() { return urgencyOn; },
  get loopEvents() { return LOOP.reduce((a, s) => a + s.length, 0); },
  set(on) { musicOn = !!on; localStorage.setItem('gb_music', musicOn ? '1' : '0'); musicOn ? this.start() : this.stop(); return musicOn; },
  start() {
    const c = ac(); if (!c || schedTimer) return;
    if (!musicBus) {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
      musicBus = c.createGain(); musicBus.gain.value = 0.32;
      musicBus.connect(lp); lp.connect(master);
      urgencyBus = c.createGain(); urgencyBus.gain.value = 0.0001;
      urgencyBus.connect(master);
    }
    musicBus.gain.setTargetAtTime(0.32, c.currentTime, 0.5);
    if (urgencyOn) urgencyBus.gain.setTargetAtTime(0.5, c.currentTime, 0.5);
    schedStart = c.currentTime + 0.05;
    schedNextEighth = 0;
    schedTimer = setInterval(() => this._sched(), 100);
    this._sched();
  },
  _sched() {
    if (!ctx) return;
    const ahead = ctx.currentTime + 0.45;
    while (schedStart + schedNextEighth * EIGHTH < ahead) {
      scheduleEighth(schedNextEighth, schedStart + schedNextEighth * EIGHTH);
      schedNextEighth++;
    }
  },
  stop() {
    clearInterval(schedTimer); schedTimer = null;
    if (musicBus && ctx) musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
    if (urgencyBus && ctx) urgencyBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
  },
  // Duck the music briefly under a sound effect, then ease back up.
  duck() {
    if (!musicBus || !ctx || !schedTimer) return;
    musicBus.gain.setTargetAtTime(0.12, ctx.currentTime, 0.1);
    clearTimeout(duckTimer);
    duckTimer = setTimeout(() => { if (musicBus && ctx) musicBus.gain.setTargetAtTime(0.32, ctx.currentTime, 0.5); }, 900);
  },
  // Last-20-seconds urgency layer: a light shaker fades in on every eighth
  // note. Same tempo — no speed-up, just urgency.
  setUrgency(on) {
    on = !!on;
    if (on === urgencyOn) return; // no-op on repeat calls (called every tick)
    urgencyOn = on;
    if (urgencyBus && ctx) urgencyBus.gain.setTargetAtTime(on ? 0.5 : 0.0001, ctx.currentTime, 0.8);
  },
  // Soft low tone when the timer drops to its last 20 seconds. Calm, no alarm.
  lowTime() {
    if (muted) return;
    tone(196, 0.6, { type: 'sine', vol: 0.12, slide: 0.9 });
  },
  pause() { if (schedTimer) { this.stop(); this._paused = true; } },
  resume() { if (this._paused && musicOn) { this._paused = false; this.start(); } },
};
