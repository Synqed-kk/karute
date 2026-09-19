import { z } from 'zod'

import type { WeeklyHours } from '@synqed-kk/client'

import { BUSINESS_TYPE_OPTIONS } from '@/lib/welcome/business-types'
import { WEEKDAY_KEYS as STORE_WEEKDAY_KEYS } from '@/lib/operating-hours'

/** Local alias so the wire type has one name in this module. */
type StoreWeeklyHours = WeeklyHours

const BUSINESS_TYPE_VALUES = BUSINESS_TYPE_OPTIONS.map((o) => o.value)

export const storeSchema = z.object({
  name: z.string().trim().min(1, 'Store name is required').max(120),
  address: z.string().trim().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  /** Which of the 26 verticals this location is — drives the per-store AI
   *  persona (business-ai-tokens) and store-scoped defaults. Must be one of
   *  the canonical BUSINESS_TYPES values. Optional at the schema so EDITS to
   *  pre-column stores never block (Greptile, #397) — createStore enforces
   *  presence for new stores. */
  business_type: z
    .string()
    .refine((v) => BUSINESS_TYPE_VALUES.includes(v), 'Unknown business type')
    .optional(),
})
export type StoreInput = z.infer<typeof storeSchema>

/** Owner-denial message — single source so the facade routes' exact-string
 *  403 elevation (a non-owner core result vs. every other soft error) can
 *  never drift out of sync with a wording change here. Lives here (not
 *  src/actions/stores.ts) because that module is 'use server' — Next/
 *  Turbopack rejects any non-async-function export from a "use server"
 *  file, and this is a plain string constant. */
export const STORE_OWNER_DENIAL = 'Only the salon owner can manage stores.'

// ── 営業時間 per store (1c-D) ───────────────────────────────────────────────
// The store's own weekly window, written from 設定 › 店舗 into core's
// `storePolicies.weekly_hours`. Lives here for the same reason
// STORE_OWNER_DENIAL does: src/actions/stores.ts is 'use server' and cannot
// export a plain constant or a sync function.

/** A week was sent with fewer than seven weekdays. REFUSED, never sent: the
 *  resolver reads an ABSENT weekday as 定休日 once the object has any key
 *  (src/lib/operating-hours.ts resolveDayHours), so a one-day save would close
 *  the store the other six days. */
export const STORE_HOURS_WEEK_INCOMPLETE = 'STORE_HOURS_WEEK_INCOMPLETE'

/** A weekday's open/close is not HH:MM, or does not open before it closes.
 *  Same-day windows only — the resolver cannot express close < open, so an
 *  overnight store is refused here rather than silently mis-resolved. */
export const STORE_HOURS_INVALID_WINDOW = 'STORE_HOURS_INVALID_WINDOW'

/** The caller's id in CORE's staff-id space could not be resolved, so the
 *  save is REFUSED. `acting_staff_id` is REQUIRED on core's policy row and
 *  core validates nothing, so a fallback would stamp a customer-facing row
 *  with an id that is not a core staff row at all — the exact profile-id-space
 *  bug src/actions/appointments.ts records having shipped once. */
export const STORE_HOURS_ACTOR_UNRESOLVED = 'STORE_HOURS_ACTOR_UNRESOLVED'

/** `storeId` is empty, not a string, or not one of the caller's OWN business's
 *  stores. A receipt-grade governance row must never carry a store id this
 *  business does not own — the same guard its locked settings sibling carries
 *  (src/lib/settings/recording-autostart.ts). */
export const STORE_HOURS_UNKNOWN_STORE = 'STORE_HOURS_UNKNOWN_STORE'

/** 00:00–23:59, zero-padded. 24:00 is deliberately OUT: `<input type="time">`
 *  cannot hold it either, so the editor and this parser refuse the same set.
 *  (The read side, minuteOfHhmm, still accepts a 24:00 written by core or the
 *  business-wide blob — this is a WRITE bound only.) */
export const STORE_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** THE one validator for a store-hours save — server truth, and the editor's
 *  own "can I save yet" predicate, so the two can never disagree. Returns a
 *  freshly BUILT seven-key object: nothing the caller sent beyond the seven
 *  weekdays can reach core.
 *
 *  Accepts exactly two shapes and nothing else: an explicit `null` — the way
 *  back to 全店共通の初期値, which the SDK defines as "clear back to
 *  unconfigured" — or all seven weekdays. `{}` is NOT a reset: the resolver
 *  reads an empty object as "not configured" and so would never notice, but
 *  the shape is still a short week and is refused as one. */
export function parseStoreWeeklyHours(
  value: unknown,
): { hours: StoreWeeklyHours | null } | { error: string } {
  if (value === null) return { hours: null }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { error: STORE_HOURS_WEEK_INCOMPLETE }
  }
  const source = value as Record<string, unknown>
  const hours: StoreWeeklyHours = {}
  for (const key of STORE_WEEKDAY_KEYS) {
    // ALWAYS SEVEN KEYS — a partial save closes six days (see the constant).
    if (!(key in source)) return { error: STORE_HOURS_WEEK_INCOMPLETE }
    const day = source[key]
    if (day === null) {
      hours[key] = null // 定休日
      continue
    }
    if (typeof day !== 'object' || Array.isArray(day)) {
      return { error: STORE_HOURS_INVALID_WINDOW }
    }
    const { open, close } = day as { open?: unknown; close?: unknown }
    if (typeof open !== 'string' || typeof close !== 'string') {
      return { error: STORE_HOURS_INVALID_WINDOW }
    }
    if (!STORE_HHMM.test(open) || !STORE_HHMM.test(close)) {
      return { error: STORE_HOURS_INVALID_WINDOW }
    }
    // Zero-padded HH:MM compares lexicographically exactly as it does
    // chronologically, so this IS "opens before it closes".
    if (open >= close) return { error: STORE_HOURS_INVALID_WINDOW }
    hours[key] = { open, close }
  }
  return { hours }
}
