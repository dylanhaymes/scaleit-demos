// All sounds are synthesized with WebAudio (no audio assets).
let ctx = null, master = null;
let muted = localStorage.getItem('gb_muted') === '1';

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
  unlock() { ac(); },
  get muted() { return muted; },
  toggle() { muted = !muted; localStorage.setItem('gb_muted', muted ? '1' : '0'); return muted; },
  pick() { tone(660, 0.07, { type: 'triangle', vol: 0.15, slide: 1.4 }); },
  place() { tone(180, 0.12, { type: 'sine', vol: 0.4, slide: 0.6 }); noise(0.05, 0.08, 0, 2500); },
  invalid() { tone(220, 0.1, { type: 'square', vol: 0.06, slide: 0.8 }); },
  clear(lines, combo) {
    const base = Math.min(combo, 5);
    const n = 3 + lines;
    for (let i = 0; i < n; i++) tone(PENTA[Math.min(PENTA.length - 1, base + i)], 0.22, { type: 'triangle', vol: 0.22, delay: i * 0.055 });
    noise(0.25, 0.1, 0.02, 4000);
    if (lines >= 2) tone(130.8, 0.5, { type: 'sine', vol: 0.35, slide: 0.5 });
  },
  combo(c) { tone(PENTA[Math.min(9, c + 2)], 0.3, { type: 'sawtooth', vol: 0.08, delay: 0.2 }); },
  boardClear() { [0, 4, 7, 12].forEach((s, i) => tone(523.25 * Math.pow(2, s / 12), 0.5, { type: 'triangle', vol: 0.2, delay: i * 0.08 })); },
  over() { [392, 349.2, 311.1, 261.6].forEach((f, i) => tone(f, 0.35, { type: 'triangle', vol: 0.2, delay: i * 0.16 })); },
  revive() { [261.6, 392, 523.25, 784].forEach((f, i) => tone(f, 0.25, { type: 'sine', vol: 0.25, delay: i * 0.07 })); },
  best() { [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.18, delay: i * 0.09 })); },
};
