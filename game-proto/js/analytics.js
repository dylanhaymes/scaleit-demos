// Simple local analytics log. Events are stored in localStorage under KEY
// (capped at MAX). Swap `sink` later for Firebase/GA4 without touching game code.
const KEY = 'gb_events';
const MAX = 500;
const session = Math.random().toString(36).slice(2, 10);

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export const Analytics = {
  session,
  sink: null, // optional (name, props) => void for a real backend later
  log(name, props = {}) {
    const ev = { t: new Date().toISOString(), s: session, name, ...props };
    const all = read();
    all.push(ev);
    while (all.length > MAX) all.shift();
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
    if (this.sink) try { this.sink(name, props); } catch {}
    return ev;
  },
  all: read,
  clear() { localStorage.removeItem(KEY); },
};
