import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isDuplicateRefusal } from '@/lib/recording/storage-duplicate'
import { isStorageNotFound, warnStorageUnknown } from '@/lib/recording/take-binding'
import {
  composeMarkKey,
  MARK_KINDS,
  MARK_PREFIX,
  parseRecordingKey,
  type MarkKind,
} from '@/lib/recording/key-grammar'

// ⚖ THE DURABLE TAKE MARK (S60 PR-A, A4). The server's verdict on the object
// under ONE take key, kept beside it in the same bucket under the key
// composeMarkKey names (`mrk/<take key>.<mark kind>.json`).
//
// ⚖ …AND ON A STAGED COPY, UNDER ITS OWN KEY (PR-K, A1/A3/A4). A mark names an
// object the server named: the staged door's `partial` lands on the STAGED key
// it composed for that copy (`mrk/<staged key>.partial.json`, markStagedCopy),
// never on a take key recomposed from the request. Two homes, by door, never a
// shared key: markTake refuses a staged key, markStagedCopy refuses a take key,
// and staged marks are read by ONE bounded listing per session
// (readStagedMarks). Finalize refuses a
// headerless object ONCE and remembers it here, so a phone that re-finalizes
// the same take every minute gets the same answer and files no second audit
// row; PR-R and PR-C read the same object as their flag.
//
// ⚖ NEVER DELETED, NEVER EDITED — SUPERSEDED (M7). A mark is written once,
// create-only (upsert:false); a second write of the same kind is refused by
// storage and answered `exists`, and nothing in this module removes or
// rewrites one. A later verdict is a NEW mark of a later kind (`rescued` from
// PR-R, `regenerated` from PR-C) standing beside the old one, and
// readTakeMarks answers every mark of the take ordered by `at`, the latest
// LAST — the latest is the take's current truth; the earlier ones stay as the
// history they are.
//
// ⚖ NUMBERS AND FLAGS ONLY. The body is `{ v, kind, at, bytes, first_byte }`:
// the object's size and its first byte as a number — never a byte array, never
// audio content (R3).

export type TakeMark = {
  v: 1
  kind: MarkKind
  at: string
  bytes: number | null
  first_byte: number | null
}

export type MarkTakeResult = 'created' | 'exists' | 'error'

/** The one storage handle this module needs — a service-role client, handed in
 *  by the caller that already holds it. */
type MarkClient = Pick<SupabaseClient, 'storage'>

/**
 * Write ONE mark on ONE take, create-only. NEVER throws: `created` when this
 * call wrote it, `exists` when storage refused a duplicate (the mark already
 * stands — the same answer the first writer got), `error` for everything else
 * (a key the grammar refuses, a storage failure, a throw).
 *
 * `takeKey` must be `businessId`'s own TAKE key; anything else — a staged
 * copy included (its mark is markStagedCopy's, PR-K A3) — answers `error`
 * without a storage call.
 */
export async function markTake(
  client: MarkClient,
  businessId: string,
  takeKey: string,
  mark: MarkKind,
  facts: { bytes: number | null; first_byte: number | null },
): Promise<MarkTakeResult> {
  try {
    if (parseRecordingKey(takeKey, businessId)?.kind !== 'take') return 'error'
    const composed = composeMarkKey(businessId, takeKey, mark)
    if (composed === null) return 'error'
    const body: TakeMark = {
      v: 1,
      kind: mark,
      at: new Date().toISOString(),
      bytes: facts.bytes,
      first_byte: facts.first_byte,
    }
    const { error } = await client.storage
      .from('recordings')
      .upload(composed.key, JSON.stringify(body), { upsert: false, contentType: 'application/json' })
    if (!error) return 'created'
    if (isDuplicateRefusal(error)) return 'exists'
    warnStorageUnknown('take-mark.write', error)
    return 'error'
  } catch (err) {
    warnStorageUnknown('take-mark.write', err)
    return 'error'
  }
}

/**
 * Write the ONE `partial` mark on ONE staged copy, create-only (PR-K, A1/A3).
 * Same answers and the same never-throw contract as markTake; its only caller
 * is the mint's staged branch (mint-take-url.ts#markPartialAtMint).
 *
 * `stagedKey` must be `businessId`'s own STAGED key — the key the door composed
 * for THAT copy; a take key or anything else answers `error` without a storage
 * call, so this writer can never land a mark in the take's home.
 */
export async function markStagedCopy(
  client: MarkClient,
  businessId: string,
  stagedKey: string,
  facts: { bytes: number | null; first_byte: number | null },
): Promise<MarkTakeResult> {
  try {
    if (parseRecordingKey(stagedKey, businessId)?.kind !== 'staged') return 'error'
    const composed = composeMarkKey(businessId, stagedKey, 'partial')
    if (composed === null) return 'error'
    const body: TakeMark = {
      v: 1,
      kind: 'partial',
      at: new Date().toISOString(),
      bytes: facts.bytes,
      first_byte: facts.first_byte,
    }
    const { error } = await client.storage
      .from('recordings')
      .upload(composed.key, JSON.stringify(body), { upsert: false, contentType: 'application/json' })
    if (!error) return 'created'
    if (isDuplicateRefusal(error)) return 'exists'
    warnStorageUnknown('take-mark.write', error)
    return 'error'
  } catch (err) {
    warnStorageUnknown('take-mark.write', err)
    return 'error'
  }
}

/** A stored body read back — a v1 mark of a known kind with a real timestamp,
 *  or null. */
function readMarkBody(text: string): TakeMark | null {
  let m: Partial<TakeMark> | null
  try {
    m = JSON.parse(text) as Partial<TakeMark> | null
  } catch {
    return null
  }
  if (
    m?.v !== 1 ||
    !(MARK_KINDS as readonly unknown[]).includes(m.kind) ||
    typeof m.at !== 'string' ||
    !Number.isFinite(Date.parse(m.at))
  ) {
    return null
  }
  return {
    v: 1,
    kind: m.kind as MarkKind,
    at: m.at,
    bytes: typeof m.bytes === 'number' ? m.bytes : null,
    first_byte: typeof m.first_byte === 'number' ? m.first_byte : null,
  }
}

/**
 * Every mark on ONE take, ordered by `at`, the LATEST LAST. NEVER throws.
 *
 * FOUR TARGETED DOWNLOADS, one per MARK_KINDS member, each at the exact key
 * composeMarkKey names — no listing of any kind, so neither `seg/` nor the
 * bucket root is ever walked. A missing mark is the ordinary case and is
 * silent; a storage error, a throw or a body that is not a v1 mark warns once
 * (status only, never the key) and is left out — a mark we cannot read is not
 * a verdict we may act on.
 */
export async function readTakeMarks(
  client: MarkClient,
  businessId: string,
  takeKey: string,
): Promise<TakeMark[]> {
  // The take-key contract (PR-K, A3): a staged copy's marks are readStagedMarks'.
  if (parseRecordingKey(takeKey, businessId)?.kind !== 'take') return []
  const found = await Promise.all(
    MARK_KINDS.map(async (kind): Promise<TakeMark | null> => {
      try {
        const composed = composeMarkKey(businessId, takeKey, kind)
        if (composed === null) return null
        const { data, error } = await client.storage.from('recordings').download(composed.key)
        if (error) {
          if (!isStorageNotFound(error)) warnStorageUnknown('take-mark.read', error)
          return null
        }
        if (!data) {
          warnStorageUnknown('take-mark.read', null)
          return null
        }
        const mark = readMarkBody(await data.text())
        if (mark === null || mark.kind !== kind) {
          warnStorageUnknown('take-mark.corrupt', null)
          return null
        }
        return mark
      } catch (err) {
        warnStorageUnknown('take-mark.read', err)
        return null
      }
    }),
  )
  return found
    .filter((m): m is TakeMark => m !== null)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/** How many names the one listing may answer — a session stages one copy per
 *  take and a copy carries at most one mark per kind, so this is far above
 *  anything real; it bounds the listing, it is not a page size to walk. */
const STAGED_MARK_LIST_LIMIT = 100

/**
 * Every mark on the staged copies of ONE recording session, ordered by `at`,
 * the LATEST LAST. NEVER throws. (PR-K, A4.)
 *
 * ONE BOUNDED LISTING, and the only listing of marks there is: the folder
 * `mrk/stg/`, filtered to the names that start `<businessId>_<sessionId>_` —
 * one session, never `seg/`, never the bucket root. Storage's filter is a
 * pattern match, so every name it answers is read back through the ONE parser
 * and kept only when it is this business's mark on a staged copy of THIS
 * session; then each is downloaded and read like readTakeMarks reads its own.
 */
export async function readStagedMarks(
  client: MarkClient,
  businessId: string,
  sessionId: string,
): Promise<TakeMark[]> {
  const folder = `${MARK_PREFIX}stg`
  let names: string[]
  try {
    const { data, error } = await client.storage.from('recordings').list(folder, {
      limit: STAGED_MARK_LIST_LIMIT,
      offset: 0,
      search: `${businessId}_${sessionId}_`,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error || !data) {
      warnStorageUnknown('take-mark.list', error ?? null)
      return []
    }
    names = data.map((f) => f.name)
  } catch (err) {
    warnStorageUnknown('take-mark.list', err)
    return []
  }
  const found = await Promise.all(
    names.map(async (name): Promise<TakeMark | null> => {
      const key = `${folder}/${name}`
      const parsed = parseRecordingKey(key, businessId)
      if (parsed?.kind !== 'mark' || parsed.target.kind !== 'staged' || parsed.target.sessionId !== sessionId) {
        return null
      }
      try {
        const { data, error } = await client.storage.from('recordings').download(key)
        if (error || !data) {
          warnStorageUnknown('take-mark.read', error ?? null)
          return null
        }
        const mark = readMarkBody(await data.text())
        if (mark === null || mark.kind !== parsed.mark) {
          warnStorageUnknown('take-mark.corrupt', null)
          return null
        }
        return mark
      } catch (err) {
        warnStorageUnknown('take-mark.read', err)
        return null
      }
    }),
  )
  return found
    .filter((m): m is TakeMark => m !== null)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
