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
}

/**
 * The remembered answer, or null — and null is a MISS, which means the caller
 * PAYS: a memo we cannot read is a charge we cannot prove, so we never pretend
 * one was made. A missing object is the ordinary first call and is silent;
 * anything else (a storage error, a throw, a body that is not a v1 memo) warns
 * once, with the status only — never the key, which is the business + take id.
 *
 * ponytail: a memo that exists but is unreadable or corrupt reads as a miss
 * forever — upsert:false means the write below never repairs it — so every
 * call for that audio pays. Upgrade path: a repair write on a parse failure,
 * on Liam's word.
 */
export async function readTranscriptMemo(key: string): Promise<TranscriptMemo | null> {
  try {
    const { data, error } = await createServiceClient().storage.from('recordings').download(key)
    if (error) {
      if (!isStorageNotFound(error)) warnStorageUnknown('transcript-memo.read', error)
      return null
    }
    if (!data) {
      warnStorageUnknown('transcript-memo.read', null)
      return null
    }
    const memo = JSON.parse(await data.text()) as Partial<TranscriptMemo> | null
    if (
      memo?.v !== 1 ||
      !memo.result ||
      typeof memo.result !== 'object' ||
      typeof memo.duration_seconds !== 'number'
    ) {
      warnStorageUnknown('transcript-memo.corrupt', null)
      return null
    }
    return memo as TranscriptMemo
  } catch (err) {
    warnStorageUnknown('transcript-memo.read', err)
    return null
  }
}

/**
 * Remember a PAID answer. Best-effort, and it NEVER throws: the money is already
 * spent and the caller already holds the result, so a memo that cannot land
 * costs only the next call's charge — it must never cost this call its answer.
 * A duplicate refusal is two doors that paid in the same moment: the first copy
 * stands, and that is silent.
 */
export async function writeTranscriptMemo(key: string, memo: TranscriptMemo): Promise<void> {
  try {
    const { error } = await createServiceClient()
      .storage.from('recordings')
      .upload(key, JSON.stringify(memo), { contentType: 'application/json', upsert: false })
    if (error && !isDuplicateRefusal(error)) warnStorageUnknown('transcript-memo.write', error)
  } catch (err) {
    warnStorageUnknown('transcript-memo.write', err)
  }
}
