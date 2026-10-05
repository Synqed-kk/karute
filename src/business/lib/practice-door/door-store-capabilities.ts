// お店ページ's switches — THE STORE-CAPABILITIES WRITER (S49 P2, DECISIONS-S49 R86), door-booking-colors.ts's twin.
// Its own file because the audit allowlist holds ONE entry per file::call (R-S39-1): a new key = a new file.
// Same guards, same order, same reasons as `writeBookingColors`; the org settings come through door.ts's own
// once-per-actor read (`orgSettingsOf`) and `settings.manage` is door.ts's one truth (`canManageSettings`).
// The record is the CORE-47 9/30 wire record (P1's model.ts), stored under ONE FLAT KEY PER STORE
// `reserve_store_capabilities:<storeId>` until CORE-47 lands. data.ts is its only importer.
// This file adds no fixture import of its own; door.ts below it (imported here) holds the practice fixtures.

import { practiceActor, visibleIds, type PracticeActor } from './actor'
import { practiceTenant } from './switch'
import { canManageSettings, listStoreOptions, orgSettingsOf } from './door'
import { renderNow } from '../clock'
import { CAP_KEYS, parseInternalRecord, parseLoses, parseRecord, recordHash, sameJson, seedRecord, seedTypeOf, serializeRecord, stampSave, storeCapabilitiesKeyFor, type BusinessTypeKey, type CapKey, type CapRecord } from '../store-page/model'

/** The record + key types, for data.ts (its sealed import inventory names this file, not the model). */
export type { BusinessTypeKey, CapRecord }

export type WriteStoreCapabilitiesResult =
  | { ok: true; record: CapRecord }
  | { ok: false; reason: 'forbidden' | 'tenant' | 'invalid' | 'stale' | 'core' }

/** R90 — the replaced raw text kept in the log line is cut at 2 000 chars. */
const REPLACED_MAX = 2000
/** R273 — a faithful wire record is ≈2.4k chars, so a real answer is always logged whole; the cut guards a runaway answer. */
const ANSWER_MAX = 8000

/** A4 — reset_keys: an array of known capability keys (internal spelling), each at most once; anything else → null. */
function resetKeysOf(raw: unknown): CapKey[] | null {
  if (!Array.isArray(raw)) return null
  const keys = raw.filter((k): k is CapKey => typeof k === 'string' && (CAP_KEYS as readonly string[]).includes(k))
  return keys.length === raw.length && keys.every((k, i) => keys.indexOf(k) === i) ? keys : null
}

/** The store's stored value. `raw` is what core holds (undefined when the key is absent); `record` its defensive
 *  parse — null for absent AND for a value that does not parse (R90: unreadable = ABSENT for read and write). */
function storedOf(settings: Record<string, unknown> | null, key: string): { raw: unknown; record: CapRecord | null } {
  const raw: unknown = settings !== null && Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : undefined
  return { raw, record: raw === undefined || raw === null ? null : parseRecord(raw) }
}

/** R190 / R201 — a stored value that parsed WITH LOSS (`before` not null): anything the parse does not carry back
 *  (model.ts parseLoses — the one definition, beside the parse), so a save would drop it. */
const lossyOf = parseLoses

/** R188 / R162 — the ONE input chain of a store's seed type, for the write's first save and readStoreSeedType: the
 *  store's own 業種 (listStoreOptions; '' when none), else the business's signup type (org settings' `business_type`,
 *  src/actions/org-settings.ts:197 reads the same field). */
async function seedTypeFor(storeId: string, settings: Record<string, unknown> | null): Promise<BusinessTypeKey> {
  const storeType = (await listStoreOptions()).find((s) => s.id === storeId)?.business_type
  return seedTypeOf(storeType, settings?.business_type)
}

/** The page payload's read: the store's saved record (defensive parse) or null — absent, unreadable, or a store
 *  this operator may not see. data.ts calls it only while the door is ON; a core failure throws, as door.ts's readers do. */
export async function readStoreCapabilities(storeId: string): Promise<CapRecord | null> {
  const actor = await practiceActor()
  if (!visibleIds(actor).includes(storeId)) return null
  return storedOf((await orgSettingsOf(actor))?.settings ?? null, storeCapabilitiesKeyFor(storeId)).record
}

/** R188 — the type this store's first save seeds from (the write's own chain, seedTypeFor), or null: the practice
 *  tenant unset, or a store this operator may not see (readStoreCapabilities' checks, in its order). It reads the org
 *  settings (orgSettingsOf, once per actor) and the store list (listStoreOptions, which builds the actor again). */
export async function readStoreSeedType(storeId: string): Promise<BusinessTypeKey | null> {
  if (practiceTenant() === null) return null
  const actor = await practiceActor()
  if (!visibleIds(actor).includes(storeId)) return null
  return seedTypeFor(storeId, (await orgSettingsOf(actor))?.settings ?? null)
}

/** S49 P2 — one store's 16 switches. `settings.manage` + a store the operator may see (as writeBookingColors) +
 *  the admitted practice tenant only. The draft is the INTERNAL record (R126, parseInternalRecord); only the value
 *  sent to core is the wire record (serializeRecord). Read-before-write, all on the SERVER:
 *  · R96 — `basedOn` must equal recordHash of the record the page loaded (absent / unreadable = recordHash(null));
 *    the stored record moved → `stale`, nothing written.
 *  · R89 — stampSave alone decides every source (the draft's source / stamps are ignored; `resetKeys` only lets a
 *    saved TYPE_DEFAULT key stay TYPE_DEFAULT). Acting staff = `actor.sheet.staff_id`, the id door-writes.ts sends
 *    core as `acting_staff_id` (A5).
 *  · R162 — no saved record → the seed of `typeKeyOf(the store's own type, else the business's signup type)`.
 *  · R90 — a stored value that does not parse is overwritten; its raw value is logged BEFORE the write (R176).
 *  A key that already holds exactly the stamped record sends nothing. A core failure is reported, never retried. */
export async function writeStoreCapabilities(
  storeId: string, record: unknown, rawResetKeys: unknown, basedOn: string,
): Promise<WriteStoreCapabilitiesResult> {
  if (practiceTenant() === null) return { ok: false, reason: 'tenant' }
  const draft = parseInternalRecord(record)
  const resetKeys = resetKeysOf(rawResetKeys)
  if (draft === null || resetKeys === null || typeof storeId !== 'string' || storeId === '') return { ok: false, reason: 'invalid' }
  const reach = await import('./core-reach') // lazy, like the colour writers: the OFF path never loads the SDK
  let actor: PracticeActor
  try {
    actor = await practiceActor()
  } catch (e) {
    if (e instanceof reach.PracticeTenantMismatch) return { ok: false, reason: 'tenant' }
    console.error('[business store capabilities] core did not answer:', e instanceof Error ? e.message : String(e))
    return { ok: false, reason: 'core' }
  }
  if (!canManageSettings(actor)) return { ok: false, reason: 'forbidden' }
  if (!visibleIds(actor).includes(storeId)) return { ok: false, reason: 'forbidden' }
  try {
    const key = storeCapabilitiesKeyFor(storeId)
    const settings = (await orgSettingsOf(actor))?.settings ?? null
    const { raw, record: before } = storedOf(settings, key)
    if (recordHash(before) !== basedOn) return { ok: false, reason: 'stale' }
    // R162 / R188: no record → the seed of seedTypeFor (the store's own 業種, else the signup type in the read above).
    // R177: only a first save (no record) needs the store list.
    const baseline = before ?? seedRecord(await seedTypeFor(storeId, settings))
    const staffId = actor.sheet.staff_id
    const next = serializeRecord(stampSave(baseline, draft, resetKeys, renderNow(), staffId))
    if (before !== null && JSON.stringify(serializeRecord(before)) === JSON.stringify(next)) return { ok: true, record: before }
    const writer = reach.orgSettingsWriterFor({ businessId: actor.businessId })
    // R176: an unreadable stored value is recorded BEFORE it is replaced — a save that fails after core committed loses nothing silently
    const unreadable = before === null && raw !== undefined && raw !== null
    if (unreadable) console.info('[business store capabilities] replacing an unreadable stored value', JSON.stringify({ business_id: actor.businessId, store_id: storeId, key, replaced_unreadable: String(JSON.stringify(raw)).slice(0, REPLACED_MAX), at: renderNow().toISOString() }))
    // R190: a value that parsed WITH LOSS gets the same line before it is replaced — nothing stored is dropped unlogged
    const lossy = before !== null && lossyOf(raw)
    if (lossy) console.info('[business store capabilities] replacing a stored value read with loss', JSON.stringify({ business_id: actor.businessId, store_id: storeId, key, replaced_lossy: String(JSON.stringify(raw)).slice(0, REPLACED_MAX), at: renderNow().toISOString() }))
    // one key per store: core merges top-level keys, so another store's save in the same instant is untouched (R86)
    const saved = await writer.orgSettings.upsert({ settings: { [storeCapabilitiesKeyFor(storeId)]: next } })
    const { raw: answered, record: out } = storedOf(saved?.settings ?? null, key)
    // R273: the answer must hold exactly what was sent (a parse alone passes an old or another record); key order is jsonb's
    if (!sameJson(answered, JSON.parse(JSON.stringify(next)))) {
      console.error(`[business store capabilities] core's answer does not hold ${key} as sent`, JSON.stringify({ business_id: actor.businessId, store_id: storeId, key, sent: JSON.stringify(next).slice(0, ANSWER_MAX), answered: String(JSON.stringify(answered)).slice(0, ANSWER_MAX) }))
      return { ok: false, reason: 'core' }
    }
    if (out === null) {
      console.error(`[business store capabilities] core's answer does not hold ${key} as sent`)
      return { ok: false, reason: 'core' }
    }
    console.info('[business store capabilities]', JSON.stringify({ business_id: actor.businessId, changed_by_staff_id: staffId, store_id: storeId, key, old: before, new: out, ...(unreadable ? { replaced_unreadable: true } : {}), ...(lossy ? { replaced_lossy: true } : {}), at: renderNow().toISOString() }))
    return { ok: true, record: out }
  } catch (e) {
    if (e instanceof reach.PracticeTenantMismatch) return { ok: false, reason: 'tenant' }
    console.error('[business store capabilities] core did not save:', e instanceof Error ? e.message : String(e))
    return { ok: false, reason: 'core' }
  }
}
