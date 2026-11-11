// All sounds are synthesized with WebAudio (no audio assets).
let ctx = null, master = null;
// SFX on by default (legacy gb_muted honored). Music ON by default for
// first-run players: no gb_music key yet means on. A player who previously
// turned music off (gb_music === '0') stays off.
let muted = localStorage.getItem('gb_sfx') ? localStorage.getItem('gb_sfx') === '0' : localStorage.getItem('gb_muted') === '1';
let musicOn = localStorage.getItem('gb_music') !== '0';
let musicBus = null, musicTimer = null, musicMelodyTimer = null, musicStep = 0;

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
};

// ---- Music: an original, calm, looping night-garden track, synthesized ----
// (no audio assets, no third-party music — see CREDITS.md). A slow low-passed
// pad (Cmaj7 - Am7 - Fmaj7 - G6, one chord every 6 s) with a sparse, gentle
// pentatonic melody drifting above it — one soft chime every few seconds, a
// slow random walk so it never quite repeats. Quiet by default; it ducks
// briefly under clear/combo sound effects and pauses when the app is hidden.
const CHORDS = [[261.63, 329.63, 392, 493.88], [220, 261.63, 329.63, 392], [174.61, 220, 261.63, 329.63], [196, 246.94, 293.66, 329.63]];
const CHORD_SECS = 6;
// Pentatonic melody notes (C major pentatonic, two octaves), slow random walk.
const MELODY = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
let melodyIdx = 3, duckTimer = null;
function chime(freq, t) {
  const c = ctx;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  const o2 = c.createOscillator(), g2 = c.createGain(); // faint octave shimmer
  o2.type = 'sine'; o2.frequency.value = freq * 2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.035, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.linearRampToValueAtTime(0.012, t + 0.08);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  o.connect(g); g.connect(musicBus); o2.connect(g2); g2.connect(musicBus);
  o.start(t); o.stop(t + 3); o2.start(t); o2.stop(t + 2);
}
function melodyTick() {
  // Step the walk by -2..+2, stay in range; sometimes rest (no note).
  melodyIdx += Math.floor(Math.random() * 5) - 2;
  melodyIdx = Math.max(0, Math.min(MELODY.length - 1, melodyIdx));
  if (Math.random() < 0.75) chime(MELODY[melodyIdx], ctx.currentTime + 0.05);
}
function padChord(freqs, t) {
  const c = ctx;
  for (const f of freqs) {
    for (const det of [-4, 4]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f / 2; o.detune.value = det;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + 2);
      g.gain.linearRampToValueAtTime(0.0001, t + CHORD_SECS + 1.5);
      o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + CHORD_SECS + 1.6);
    }
  }
}
export const Music = {
  get on() { return musicOn; },
  set(on) { musicOn = !!on; localStorage.setItem('gb_music', musicOn ? '1' : '0'); musicOn ? this.start() : this.stop(); return musicOn; },
  start() {
    const c = ac(); if (!c || musicTimer) return;
    if (!musicBus) {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      musicBus = c.createGain(); musicBus.gain.value = 0.35;
      musicBus.connect(lp); lp.connect(master);
    }
    musicBus.gain.setTargetAtTime(0.35, c.currentTime, 0.5);
    const tick = () => { padChord(CHORDS[musicStep++ % CHORDS.length], ctx.currentTime + 0.05); };
    tick(); musicTimer = setInterval(tick, CHORD_SECS * 1000);
    // Melody chimes on their own slow clock, offset from the chord changes.
    melodyTick(); musicMelodyTimer = setInterval(melodyTick, 3400);
  },
  stop() {
    clearInterval(musicTimer); musicTimer = null;
    clearInterval(musicMelodyTimer); musicMelodyTimer = null;
    if (musicBus && ctx) musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
  },
  // Duck the music briefly under a sound effect, then ease back up.
  duck() {
    if (!musicBus || !ctx || !musicTimer) return;
    musicBus.gain.setTargetAtTime(0.12, ctx.currentTime, 0.1);
    clearTimeout(duckTimer);
    duckTimer = setTimeout(() => { if (musicBus && ctx) musicBus.gain.setTargetAtTime(0.35, ctx.currentTime, 0.5); }, 900);
  },
  // Last-10-seconds urgency layer. No-op in this build — the upbeat track in
  // Design Update 2 adds the extra percussion layer here.
  setUrgency(on) {},
  // Soft low tone when the timer drops to its last 10 seconds. Calm, no alarm.
  lowTime() {
    if (muted) return;
    tone(196, 0.6, { type: 'sine', vol: 0.12, slide: 0.9 });
  },
  pause() { if (musicTimer) { this.stop(); this._paused = true; } },
  resume() { if (this._paused && musicOn) { this._paused = false; this.start(); } },
};
