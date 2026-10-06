// お店ページ's switches — THE CLIENT CALL (S61 P7B-1, DECISIONS-S61 R222): the twin of the room's `putCardColor`
// (SettingsScreen.tsx). PUT /api/business/store-capabilities with the admitted business in `x-expected-business`,
// the body EXACTLY { storeId, record, reset_keys, based_on } (the route's A4 check). It imports only the model.

import { parseInternalRecord, recordHash, type CapKey, type CapRecord } from './model'

export type CapsSaveReason = 'forbidden' | 'tenant' | 'invalid' | 'stale' | 'core' | 'disconnected'
export type CapsSaveResult = { ok: true; record: CapRecord; basedOn: string } | { ok: false; reason: CapsSaveReason }

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
    const answer = (body ?? {}) as { ok?: unknown; record?: unknown; reason?: unknown }
    if (res.ok && answer.ok === true) {
      const record = parseInternalRecord(answer.record)
      return record === null ? { ok: false, reason: 'core' } : { ok: true, record, basedOn: recordHash(record) }
    }
    const reason = CAPS_SAVE_REASONS.find((r) => r === answer.reason)
    return { ok: false, reason: reason ?? 'core' }
  } catch {
    return { ok: false, reason: 'core' }
  }
}
