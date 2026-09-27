// Harness-only stand-in for `@/actions/karute` (S46 LEG 1b) — the fit
// harness's vite.config.ts aliases that one specifier here, so ONLY the
// harness build resolves this file (the app, the thin bundle and jest import
// the real module / the thin port). Every export IS the thin port's own
// (thin/ports/actions.vite.ts), except `loadKaruteWindow` on a
// `?shinki=<N>` page: a MONTH read answers, offline, with that month's
// fixture rows — the same N 新規 rows under the page's pick — so the 新規 count
// inside a picked month is a real tally (⚖ 8/25: the rows its own tap would
// reveal). Any other page or read = the port's function, unchanged (offline it
// never resolves to rows, exactly as before this file existed).
import type { KaruteWindowPage } from '@/actions/karute'
import { loadKaruteWindow as portLoadKaruteWindow } from '../../thin/ports/actions.vite'
import { karuteShinkiItems, shinkiOwner } from './fixtures'

export * from '../../thin/ports/actions.vite'

export const loadKaruteWindow: typeof portLoadKaruteWindow = async (input) => {
  const q = new URLSearchParams(location.search)
  const n = q.get('shinki')
  if (!input.month || !/^\d+$/.test(n ?? '')) return portLoadKaruteWindow(input)
  const page: KaruteWindowPage = {
    items: karuteShinkiItems(Number(n), shinkiOwner(q.get('s')), input.month),
    windowStart: `${input.month}-01`,
    freshStoreTotal: 1234,
    freshDiscardedCount: 12,
    hasMore: false,
  }
  return page
}
