import { BUSINESS_TYPE_KEYS, CAP_KEYS, lockOff, standardOn, type BusinessTypeKey, type CapKey, type CapRecord } from './model'

/** S59 P7A (C1) — the お店ページ draft has ONE truth: the 設定 room's `values` map. The ids are the room's own
 *  (settings.ts `STORE_PAGE_FAMILY_ID` / `storePageSwitchId`, the ones `controlIdsOf` counts); this file imports
 *  nothing but the model, so the caller hands them in and they are never retyped here. */
export interface StorePageIds {
  readonly family: string
  readonly sw: (key: CapKey) => string
  /** S75 fix 1 (SF2/SF3) — the draft's defaults_type (業種の標準に戻す sets it); absent = the saved record's. */
  readonly defaults?: string
}

/** A record → its 17 value entries: the 業種 (the type key) and each switch's `on` (+ defaults_type when the ids name it). */
export function storePageValues(rec: CapRecord, ids: StorePageIds): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = { [ids.family]: rec.business_type }
  if (ids.defaults !== undefined) out[ids.defaults] = rec.defaults_type
  for (const k of CAP_KEYS) out[ids.sw(k)] = rec.switches[k].on
  return out
}

const isTypeKey = (raw: unknown): raw is BusinessTypeKey =>
  typeof raw === 'string' && (BUSINESS_TYPE_KEYS as readonly string[]).includes(raw)

/** (saved record, values) → the draft: ALWAYS a complete record (P6 attack NIT2) — the saved record with only the
 *  business_type and each switch's `on` taken from the values; a value missing or of the wrong type keeps the saved one.
 *  S75 fix 3b (R-E′): `touched` = the switches the room saw hand-flipped or flipped by 戻す since the last save. */
export function storePageDraft(
  saved: CapRecord, values: Readonly<Record<string, unknown>>, ids: StorePageIds, touched: readonly CapKey[],
): CapRecord {
  const t = values[ids.family]
  const dtRaw = ids.defaults !== undefined ? values[ids.defaults] : undefined
  const bt = isTypeKey(t) ? t : saved.business_type
  const dt = isTypeKey(dtRaw) ? dtRaw : saved.defaults_type
  const switches = {} as Record<CapKey, CapRecord['switches'][CapKey]>
  for (const k of CAP_KEYS) {
    const on = values[ids.sw(k)]
    const was = saved.switches[k]
    // S75 fix 3b (R-E′): a TYPE_DEFAULT key NOT in `touched` (no hand flip / 戻す flip since the last save) reads the
    // draft's standard — a pure overlay, nothing written into values — so a pick to a locked type and back shows the
    // table's value under the true label; a touched key keeps the room's value
    if (was.source === 'TYPE_DEFAULT' && !touched.includes(k)) {
      const std = standardOn(bt, dt, k)
      switches[k] = std === was.on ? was : { ...was, on: std }
    } else switches[k] = typeof on === 'boolean' && on !== was.on ? { ...was, on } : was
  }
  // S75 fix 1 (SF1): the R269 lock is a READ-TIME overlay — the draft reads a locked key OFF, the values keep the owner's
  // `on`. Kept after R-E′: redundant for untouched TYPE_DEFAULT keys, still needed for OWNER / touched keys
  return lockOff({ v: 1, business_type: bt, defaults_type: dt, switches })
}

/** S75 fix 1 (SF1) — the value entries an edit WRITES: only those that differ from the draft before it, so the lock's
 *  overlay (a locked key reading OFF) is never written back over the owner's own `on`. */
export function storePageEdits(before: CapRecord | null, next: CapRecord, ids: StorePageIds): Record<string, string | boolean> {
  const was = before === null ? {} : storePageValues(before, ids)
  return Object.fromEntries(Object.entries(storePageValues(next, ids)).filter(([id, v]) => before === null || was[id] !== v))
}

/** C4 / R182 — a HAND flip removes from the reset keys every key whose `on` differs between the draft before the flip
 *  and the record handed in. (戻す adds keys through StorePageType's own updater; the room's 元に戻す empties them.) */
export function afterHandFlip(keys: readonly CapKey[], before: CapRecord, next: CapRecord): readonly CapKey[] {
  return keys.filter((k) => before.switches[k].on === next.switches[k].on)
}

/** S75 fix 3b (R-E′) — the keys whose `on` differs between the draft before an edit and the record handed in (a hand
 *  flip's key, 戻す's flips; a 業種 pick moves none): the room adds them to its touched set. */
export function flippedKeys(before: CapRecord, next: CapRecord): readonly CapKey[] {
  return CAP_KEYS.filter((k) => before.switches[k].on !== next.switches[k].on)
}
