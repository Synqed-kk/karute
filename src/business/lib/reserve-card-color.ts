export const RESERVE_CARD_PRESETS = ['#285643','#304A6D','#664D66','#9A573D','#52636A'] as const
export function normalizeCardColor(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : undefined
}
export function cardForeground(hex: string): string {
  const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4)
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2] > .179 ? '#101C18' : '#FFFFFF'
}

// Same accepted Satin palette as Reserve src/lib/satin-material.ts. Hex-only settings contract.
type RGB = number[];
const mix = (a: RGB, b: RGB, t: number) => a.map((n, i) => n + (b[i] - n) * t);
const lum = (c: RGB) => c.reduce((n, v, i) => n + (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i], 0);
const css = (c: RGB) => `rgb(${c.map(n => Math.round(n * 255)).join(' ')})`;
export function satinVars(color: string): Record<string, string> {
  const hex = color;
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
