// Haptics hook. Native (Capacitor) -> Haptics plugin; web -> navigator.vibrate; else no-op.
// Purely cosmetic: never affects gameplay. Toggle stored in localStorage gb_haptics.
let enabled = localStorage.getItem('gb_haptics') !== '0';

function plugin() {
  const C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return null;
  return (C.Plugins && C.Plugins.Haptics) || null;
}
function buzz(style, ms) {
  if (!enabled) return;
  try {
    const H = plugin();
    if (H && H.impact) { H.impact({ style }).catch(() => {}); return; }
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {}
}
export const Haptics = {
  get enabled() { return enabled; },
  set(on) { enabled = !!on; localStorage.setItem('gb_haptics', enabled ? '1' : '0'); return enabled; },
  light() { buzz('LIGHT', 10); },   // piece placed
  medium() { buzz('MEDIUM', 25); }, // line clear
};
