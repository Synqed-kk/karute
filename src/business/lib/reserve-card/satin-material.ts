// Verified port of Synqed-kk/reserve src/lib/satin-material.ts @ c2a9f9543187 — keep byte-identical below this line; re-port when Reserve changes (see PARITY.md).
/** The accepted Satin palette: tenant colour in, contrast-safe continuous tones out. */
type RGB = number[];
const mix = (a: RGB, b: RGB, t: number) => a.map((n, i) => n + (b[i] - n) * t);
const lum = (c: RGB) => c.reduce((n, v, i) => n + (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i], 0);
const css = (c: RGB) => `rgb(${c.map(n => Math.round(n * 255)).join(' ')})`;
export function satinVars(color: string | undefined): Record<string, string> {
  let hex = color && /^#[\da-f]{6}$/i.test(color) ? color : '#1c2247';
  // BrandTheme also accepts CSS colours (including OKLCH). Let the browser's
  // colour parser resolve them once, rather than guessing a different hue.
  if (color && !/^#[\da-f]{6}$/i.test(color) && typeof document !== 'undefined' && CSS.supports('color', color)) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (ctx) { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); hex = '#' + Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join(''); }
  }
  const raw = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  let lo = mix(raw, [0, 0, 0], .22), hi = mix(raw, [1, 1, 1], .16);
  const dark = lum(raw) < .2;
  if (dark) {
    const floor = Math.min(...raw);
    const vivid = raw.map(v => Math.max(0, floor * .55 + (v - floor) * 1.35));
    lo = vivid.map(v => Math.min(1, v * .72));
    hi = vivid.map(v => Math.min(1, v * 1.65));
    while (lum(lo) > .12) lo = lo.map(v => v * .975);
    while (lum(hi) > .155) hi = mix(hi, [0, 0, 0], .025);
  } else {
    while (lum(lo) < .28) lo = mix(lo, [1, 1, 1], .025);
    while (lum(hi) < .28) hi = mix(hi, [1, 1, 1], .025);
  }
  return { '--satin-low': css(lo), '--satin-high': css(hi), '--satin-body': css(mix(lo, hi, .28)), '--satin-shoulder': css(mix(lo, hi, .56)), '--satin-ink': dark ? '#f5f7ef' : '#18221b', '--satin-base': css(mix(lo, hi, .5)) };
}
