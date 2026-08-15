import { unstable_cache } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'
import { getBusinessId } from '@/lib/staff'

// The 予約 booking picker's menu source (PR-4a read leg; PR-4b renders it).
//
// FACADE-SAFE TWIN STYLE, deliberately NOT the day-agenda-cached style: the
// cache body reads NO cookies/auth — businessId arrives as the argument, which
// is also the cache key — so the facade route may call it on a Bearer identity
// without either throwing on the cookie read or serving one identity's entry to
// another (the rationale web-only-cache-facade-ban.test.ts enforces for its
// BANNED list; this module belongs on neither side of that ban because it never
// reaches for the session).
//
// 60s staleness is the documented contract (§4): a catalog edit repaints the
// picker within a minute, and the four menu writers in src/actions/menus.ts
// call updateTag('menus') so a real edit repaints immediately (same tab
// immediately; other tabs/devices ride the ~25s QuietRefresh envelope —
// updateTag drops the data cache, not the router cache).
// KNOWN LAG: storeName rides a stores.list() that carries NO 'menus' tag, so a
// store RENAME can show the old chip label for up to 60s — accepted, same
// staleness class as the menu rows themselves.

export interface CachedMenuOption {
  id: string
  name: string
  category: string | null
  category_display_order: number
  display_order: number
  duration_minutes: number
  price_list_amount: number
  price_min_amount: number | null
  store_id: string | null
  /** Resolved store name for the picker's store chip (§4). null = all-store
   *  menu OR the store row was missing (defensive). */
  storeName: string | null
}

// businessId is the cache key — Next includes function args in the key
// automatically, so each tenant gets its own entry. The static tag lets the
// menu writers invalidate every tenant's entry with one updateTag('menus').
const menuOptionsByBusiness = unstable_cache(
  async (businessId: string): Promise<CachedMenuOption[]> => {
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) {
      throw new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
    }
    const client = new SynqedClient({ baseUrl, apiKey, businessId })
    // active: true — the picker offers only bookable menus; the 停止中 rows the
    // settings surface discloses have no place in a booking dialog. menus.list
    // returns the whole list (no pagination), same as listMenus.
    const [{ menus }, { stores }] = await Promise.all([
      client.menus.list({ active: true }),
      client.stores.list(),
    ])
    const storeNameById = new Map(stores.map((s) => [s.id, s.name]))
    // Pre-sorted server-side so the web page and the facade agree on the core
    // order without either consumer re-deriving it: category band, then the
    // shop's own ordering inside the band, then name as the stable tiebreak
    // (plain </> like customers/cached.ts — ja-safe and locale-free).
    return menus
      .map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category ?? null,
        category_display_order: m.category_display_order,
        display_order: m.display_order,
        duration_minutes: m.duration_minutes,
        price_list_amount: m.price_list_amount,
        price_min_amount: m.price_min_amount ?? null,
        store_id: m.store_id ?? null,
        // An unknown store id resolves to null rather than throwing — a menu
        // pointing at a deleted/invisible store still belongs in the picker,
        // just without a chip.
        storeName: m.store_id ? (storeNameById.get(m.store_id) ?? null) : null,
      }))
      .sort(
        (a, b) =>
          a.category_display_order - b.category_display_order ||
          a.display_order - b.display_order ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      )
  },
  ['cached-menu-options-v1'],
  { revalidate: 60, tags: ['menus'] },
)

/**
 * businessId-EXPLICIT variant — reads no auth (cookies), so the facade screen
 * route can call it on a Bearer identity. Unlike the customer twin there is no
 * storeId lens and so no arity trick: the picker always needs the business's
 * full active union (§6) — an all-store menu is bookable at every store, and
 * the store chip (not a filter) is what tells the two apart.
 */
export function getCachedMenuOptionsFor(
  businessId: string,
): Promise<CachedMenuOption[]> {
  return menuOptionsByBusiness(businessId)
}

/** Cookie-session wrapper — the web page's entry point. Same 60s cache + the
 *  same 'menus' tag as the explicit variant. */
export async function getCachedMenuOptions(): Promise<CachedMenuOption[]> {
  const businessId = await getBusinessId()
  return menuOptionsByBusiness(businessId)
}
