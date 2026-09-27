// Harness-only stand-in for src/lib/karute/karute-switches.ts — the fit
// harness's vite.config.ts aliases `@/lib/karute/karute-switches` here, so
// ONLY the harness build ever resolves this file (the app, the thin bundle
// and jest import the real registry). It never flips the source value:
//   - no `shinki` param → exactly the committed registry (the real object);
//   - `?shinki=on`      → the 新規 chip ON for this harness page only, so
//     run.mjs can prove the chip row still fits (S45 invariant 3);
//   - `?shinki=<N>`     → ON too, with exactly N 新規 rows under the page's
//     pick (S46 LEG 1b, shinki-on-c.mjs).
import { KARUTE_SWITCHES as COMMITTED } from '../../src/lib/karute/karute-switches'

const param = new URLSearchParams(location.search).get('shinki')
const on = param === 'on' || /^\d+$/.test(param ?? '')

export const KARUTE_SWITCHES: { readonly [K in keyof typeof COMMITTED]: boolean } = on
  ? { ...COMMITTED, shinkiChip: true }
  : COMMITTED
