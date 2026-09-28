import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { isDuplicateRefusal } from '@/lib/recording/assembler'
import { isStorageNotFound, warnStorageUnknown } from '@/lib/recording/take-binding'

// ⚖ CHARGE ONCE (PR-5). The provider's answer for one audio object in one
// language, kept BESIDE that audio in the same bucket, under the key
// composeTranscriptKey names (`trc/<audio key>.<locale>.json`). The meter reads
// it before it would ask the ceiling, reserve or pay, and writes it only after
// the provider answered — so a reload, a second save or the job door never pays
// twice for the same audio. No table, no core call: storage is the ledger's
// witness here, and upsert:false makes the first paid answer the one that stands.

export type TranscriptMemo = {
  v: 1
  result: Record<string, unknown>
  duration_seconds: number
  written_at: string
  /** Present only when the paid answer ran LONGER than the reserve, i.e. a
   *  true-up was owed (see TranscriptTrueUp). Absent = nothing owed, or a memo
   *  written after its true-up had already run (every memo before S56). */
  trueUp?: TranscriptTrueUp
}

/** ⚖ THE TRUE-UP MARK (S56, PR 1 Greptile Finding 1). The meter writes the memo
 *  BEFORE the ledger true-up (S53 A3), so a process that dies between the two
 *  used to leave a memo that replays forever while the difference between the
 *  reserve and the real cost was never recorded. The memo now says so itself:
 *  written `pending` with the numbers BEFORE the true-up, rewritten `recorded`
 *  only after the ledger took it. A replay that finds `pending` records the
 *  delta then (runMeteredTranscription). Soft and self-retrying: a failed
 *  attempt stays `pending` with one more attempt counted — never cleared, never
 *  deleted. Numbers only (cents, counts, a time) — never a word of the
 *  transcript, never a key. */
export type TranscriptTrueUp = {
  status: 'pending' | 'recorded'
  reserveCents: number
  costCents: number
  deltaCents: number
  attempts: number
  lastError?: string
  updatedAt: number
}

/** What a write did: `written` = this object is now ours; `taken` = the
 *  duplicate refusal, another caller's copy stands; `failed` = storage erred or
 *  threw (already warned) and the object's state is unknown. */
export type TranscriptMemoWrite = 'written' | 'taken' | 'failed'

/** What the read found. `corrupt` is PROVEN garbage — the object came back and
 *  its body is not a v1 memo — and is the one state the next paid write may
 *  replace; a storage error or a throw is only a `miss`, because an object we
 *  could not read may be perfectly good. */
export type TranscriptMemoRead =
  | { state: 'hit'; memo: TranscriptMemo }
  | { state: 'miss' }
  | { state: 'corrupt' }

/**
 * The remembered answer. Anything but a hit means the caller PAYS: a memo we
 * cannot read is a charge we cannot prove, so we never pretend one was made. A
 * missing object is the ordinary first call and is silent; anything else (a
 * storage error, a throw, a body that is not a v1 memo) warns once, with the
 * status only — never the key, which is the business + take id.
 *
 * A corrupt object is repaired by the next paid answer (writeTranscriptMemo's
 * `repair`); a readable one is never replaced.
 */
export async function readTranscriptMemo(key: string): Promise<TranscriptMemoRead> {
  let body: string
  try {
    const { data, error } = await createServiceClient().storage.from('recordings').download(key)
    if (error) {
      if (!isStorageNotFound(error)) warnStorageUnknown('transcript-memo.read', error)
      return { state: 'miss' }
    }
    if (!data) {
      warnStorageUnknown('transcript-memo.read', null)
      return { state: 'miss' }
    }
    body = await data.text()
  } catch (err) {
    warnStorageUnknown('transcript-memo.read', err)
    return { state: 'miss' }
  }
  let memo: Partial<TranscriptMemo> | null
  try {
    memo = JSON.parse(body) as Partial<TranscriptMemo> | null
  } catch {
    memo = null
  }
  if (
    memo?.v !== 1 ||
    !memo.result ||
    typeof memo.result !== 'object' ||
    typeof memo.duration_seconds !== 'number'
  ) {
    warnStorageUnknown('transcript-memo.corrupt', null)
    return { state: 'corrupt' }
  }
  return { state: 'hit', memo: memo as TranscriptMemo }
}

/**
 * Remember a PAID answer. Best-effort, and it NEVER throws: the money is already
 * spent and the caller already holds the result, so a memo that cannot land
 * costs only the next call's charge — it must never cost this call its answer.
 *
 * `repair` is true only when the read before this call PROVED the object
 * corrupt; then, and only then, the write replaces it. Otherwise it is
 * create-only, and a duplicate refusal is two doors that paid in the same
 * moment: the first copy stands, and that is silent.
 *
 * `mark` (S56) is the one other replacing write: the SAME memo rewritten with
 * its true-up mark moved on (recorded, or one more attempt) — by the caller
 * that wrote it `pending` a moment before, or by a replay that read it
 * `pending`. The result, duration and written_at ride along unchanged.
 */
export async function writeTranscriptMemo(
  key: string,
  memo: TranscriptMemo,
  opts: { repair: boolean; mark?: boolean },
): Promise<TranscriptMemoWrite> {
  try {
    const { error } = await createServiceClient()
      .storage.from('recordings')
      .upload(key, JSON.stringify(memo), {
        contentType: 'application/json',
        upsert: opts.repair || opts.mark === true,
      })
    if (!error) return 'written'
    if (isDuplicateRefusal(error)) return 'taken'
    warnStorageUnknown('transcript-memo.write', error)
    return 'failed'
  } catch (err) {
    warnStorageUnknown('transcript-memo.write', err)
    return 'failed'
  }
}
