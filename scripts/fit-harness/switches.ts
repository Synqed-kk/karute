// Harness-only stand-in for src/lib/karute/karute-switches.ts — the fit
// harness's vite.config.ts aliases `@/lib/karute/karute-switches` here, so
// ONLY the harness build ever resolves this file (the app, the thin bundle
// and jest import the real registry). It never flips the source value:
//   - no `shinki` param → exactly the committed registry (the real object);
//   - `?shinki=on`      → the 新規 chip ON for this harness page only, so
//     run.mjs can prove the chip row still fits (S45 invariant 3).
import { KARUTE_SWITCHES as COMMITTED } from '../../src/lib/karute/karute-switches'

const on = new URLSearchParams(location.search).get('shinki') === 'on'

export const KARUTE_SWITCHES: { readonly [K in keyof typeof COMMITTED]: boolean } = on
  ? { ...COMMITTED, shinkiChip: true }
  : COMMITTED
