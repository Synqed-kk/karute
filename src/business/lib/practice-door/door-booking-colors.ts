// 予約の色分け — THE SECOND GUARDED WRITER (PKT-S38 R3, Liam 9/25 「make it work」), door.ts's sibling.
// Its own file because the audit allowlist holds ONE entry per file::call and door.ts's
// `orgSettings.upsert` entry is the card writer's, sealed by lock 3 (R-S39-1): a new key = a new file.
// Same guards, same order, same reasons as door.ts's `writeReserveCardColor`; it reads the org settings
// through door.ts's own once-per-actor read (`orgSettingsOf`) and asks door.ts's one `settings.manage`
// truth (`canManageSettings`). data.ts is its only importer.

import { practiceActor, visibleIds, type PracticeActor } from './actor'
import { practiceTenant } from './switch'
import { canManageSettings, orgSettingsOf } from './door'
import { renderNow } from '../clock'
import { BOOKING_PALETTE, bookingColorsFor, bookingColorsKeyFor, type BookingColors } from '../booking-colors'

export type WriteBookingColorsResult =
  | { ok: true; colors: BookingColors }
  | { ok: false; reason: 'forbidden' | 'tenant' | 'invalid' | 'core' }

const BOOKING_KEYS = ['new', 'repeat', 'ticket', 'vip'] as const
/** A plain object: no array, and its prototype is null or SOME realm's Object.prototype (a parsed request body
 *  can come from another realm, so `=== Object.prototype` would refuse every real save). */
const plainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto: unknown = Object.getPrototypeOf(v)
  return proto === null || Object.getPrototypeOf(proto) === null
}
/** R3(b) — EXACTLY the four own keys, each a BOOKING_PALETTE hex (any case) → lowercase; anything else → null. */
function bookingColorsInput(colors: unknown): BookingColors | null {
  if (!plainObject(colors)) return null
  const keys = Object.keys(colors)
  if (keys.length !== BOOKING_KEYS.length || !BOOKING_KEYS.every((k) => keys.includes(k))) return null
  const hex = (k: (typeof BOOKING_KEYS)[number]) => {
    const v = colors[k]
    const low = typeof v === 'string' ? v.toLowerCase() : ''
    return BOOKING_PALETTE.some((c) => c.hex === low) ? low : null
  }
  const out = { new: hex('new'), repeat: hex('repeat'), ticket: hex('ticket'), vip: hex('vip') }
  return out.new && out.repeat && out.ticket && out.vip ? { new: out.new, repeat: out.repeat, ticket: out.ticket, vip: out.vip } : null
}

/** ⚖ PKT-S38 R3 (Liam 9/25 「make it work」) — THE SECOND BUSINESS WRITER: one store's 予約の色分け, mirrored
 *  from writeReserveCardColor. OFF has no writer. Only the four board categories, each a BOOKING_PALETTE hex,
 *  checked before any core call. `settings.manage` on core's own sheet, AND the store must be one this
 *  operator may see — `actor.visible`, the same list the 設定 page offers (listStoreOptions; ⚖ 8/17 store
 *  isolation), so a key the actor cannot see is never written. ⚖ PKT-S41 R-S41-1 (Liam 9/25 A): the store's
 *  four live under ITS OWN key `booking_colors:<storeId>`, sent ALONE — core merges only TOP-LEVEL keys
 *  (org-settings.service.ts:50), so no other store's key is read for the write or touched by it. The legacy
 *  `booking_colors` map is never written or inspected here (read-only fallback, never removed). A stored
 *  per-store value that is not a colour set is never overwritten (⚖ 9/16 nothing deleted). Read-before-write:
 *  a key that already holds exactly these four sends nothing. A core failure is reported, never swallowed or
 *  retried. */
export async function writeBookingColors(storeId: string, colors: unknown): Promise<WriteBookingColorsResult> {
  if (practiceTenant() === null) return { ok: false, reason: 'tenant' }
  const next = bookingColorsInput(colors)
  if (next === null || typeof storeId !== 'string' || storeId === '') return { ok: false, reason: 'invalid' }
  const reach = await import('./core-reach') // lazy, like the card writer: the OFF path never loads the SDK
  let actor: PracticeActor
  try {
    actor = await practiceActor()
  } catch (e) {
    if (e instanceof reach.PracticeTenantMismatch) return { ok: false, reason: 'tenant' }
    console.error('[business booking colours] core did not answer:', e instanceof Error ? e.message : String(e))
    return { ok: false, reason: 'core' }
  }
  if (!canManageSettings(actor)) return { ok: false, reason: 'forbidden' }
  if (!visibleIds(actor).includes(storeId)) return { ok: false, reason: 'forbidden' }
  try {
    const key = bookingColorsKeyFor(storeId)
    const settings: Record<string, unknown> | null = (await orgSettingsOf(actor))?.settings ?? null
    const before: unknown = (settings !== null && Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : undefined) ?? null
    if (before !== null && !plainObject(before)) {
      console.error(`[business booking colours] stored ${key} is not a colour set; refusing to overwrite`)
      return { ok: false, reason: 'core' }
    }
    // Equal = the stored key holds exactly these four (lowercase) AND the resolver already answers them.
    const same = plainObject(before) && Object.keys(before).length === BOOKING_KEYS.length && BOOKING_KEYS.every((k) => before[k] === next[k])
    if (same && BOOKING_KEYS.every((k) => bookingColorsFor(storeId, settings)[k] === next[k])) return { ok: true, colors: next }
    const writer = reach.orgSettingsWriterFor({ businessId: actor.businessId })
    // one key per store: core merges top-level keys, so another store's save in the same instant is untouched (⚖ Liam 9/25 A)
    const saved = await writer.orgSettings.upsert({ settings: { [bookingColorsKeyFor(storeId)]: next } })
    const out = bookingColorsFor(storeId, saved?.settings)
    console.info('[business booking colours]', JSON.stringify({ business_id: actor.businessId, actor: actor.card.id, store_id: storeId, key, old: before, new: out, at: renderNow().toISOString() }))
    return { ok: true, colors: out }
  } catch (e) {
    if (e instanceof reach.PracticeTenantMismatch) return { ok: false, reason: 'tenant' }
    console.error('[business booking colours] core did not save:', e instanceof Error ? e.message : String(e))
    return { ok: false, reason: 'core' }
  }
}
