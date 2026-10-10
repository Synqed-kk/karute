// お店ページ's switches — THE CLIENT CALL (S61 P7B-1, DECISIONS-S61 R222): the twin of the room's `putCardColor`
// (SettingsScreen.tsx). PUT /api/business/store-capabilities with the admitted business in `x-expected-business`,
// the body EXACTLY { storeId, record, reset_keys, based_on } (the route's A4 check). It imports only the model.

import { parseInternalRecord, recordHash, type CapKey, type CapRecord } from './model'

/** S75 fix 1: 'locked' = the door's 'invalid' carrying `locked` (a key the 業種 locks OFF was sent ON) — its own line. */
export type CapsSaveReason = 'forbidden' | 'tenant' | 'invalid' | 'stale' | 'core' | 'disconnected' | 'locked'
export type CapsSaveResult = { ok: true; record: CapRecord; basedOn: string } | { ok: false; reason: CapsSaveReason; ref?: string }

/** ⚖ P2 · R-S97-2 — THE one check of a refusal's ref (the bound's 8 hex) for the room's saves; anything else is none. */
export const isCoreRef = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v)

const CAPS_SAVE_URL = '/api/business/store-capabilities'
const CAPS_SAVE_REASONS: ReadonlyArray<CapsSaveReason> = ['forbidden', 'tenant', 'invalid', 'stale', 'core', 'disconnected']

/** The route's answer → the room's. It never throws. ok ONLY on a 200 whose body is `ok: true` with a record the
 *  strict internal parse accepts; then the PARSED record and its recordHash — the next save's `based_on`, the hash the
 *  door computes for that same stored record (R222), never a hash of the draft. A 200 whose record does not parse is
 *  'core'; otherwise the body's reason when it is one of the six; anything the room cannot read (a network failure,
 *  a 404, a body that is not the route's) is 'core'. */
export async function putStoreCapabilities(
  businessId: string,
  save: { storeId: string; record: CapRecord; resetKeys: readonly CapKey[]; basedOn: string },
): Promise<CapsSaveResult> {
  try {
    const res = await fetch(CAPS_SAVE_URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-expected-business': businessId },
      body: JSON.stringify({ storeId: save.storeId, record: save.record, reset_keys: [...save.resetKeys], based_on: save.basedOn }),
    })
    const body: unknown = await res.json().catch(() => null)
    const answer = (body ?? {}) as { ok?: unknown; record?: unknown; reason?: unknown; locked?: unknown; ref?: unknown }
    if (res.ok && answer.ok === true) {
      const record = parseInternalRecord(answer.record)
      return record === null ? { ok: false, reason: 'core' } : { ok: true, record, basedOn: recordHash(record) }
    }
    if (answer.reason === 'invalid' && typeof answer.locked === 'string') return { ok: false, reason: 'locked' }
    const reason = CAPS_SAVE_REASONS.find((r) => r === answer.reason)
    // ⚖ P2 · R-S97-2 — the bound's ref (8 hex) rides along so the room can print the number.
    return { ok: false, reason: reason ?? 'core', ...(isCoreRef(answer.ref) ? { ref: answer.ref } : {}) }
  } catch {
    return { ok: false, reason: 'core' }
  }
}
