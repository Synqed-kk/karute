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
 */
export async function writeTranscriptMemo(
  key: string,
  memo: TranscriptMemo,
  opts: { repair: boolean },
): Promise<void> {
  try {
    const { error } = await createServiceClient()
      .storage.from('recordings')
      .upload(key, JSON.stringify(memo), { contentType: 'application/json', upsert: opts.repair })
    if (error && !isDuplicateRefusal(error)) warnStorageUnknown('transcript-memo.write', error)
  } catch (err) {
    warnStorageUnknown('transcript-memo.write', err)
  }
}

// ⚖ S53 A5 — THE "TRANSCRIBING NOW" LEASE (awaits Liam's word: transcribe.ts's
// own reservation, "a create-only lease object with a TTL, on Liam's word").
// The memo is written AFTER the money moves, so two calls on the same audio
// inside the provider at once both missed it and both paid (a retry 1.5 s
// after a dropped connection, a quick 再試行 tap). The lease is written BEFORE
// the reserve, beside the memo in the same bucket — a storage object, never a
// database row — and names only when it stops counting. It is never deleted:
// the holder RELEASES it (overwrites it as already expired) when its call
// ends, whatever the outcome; a holder that died leaves it until it expires,
// and expiry falls open to paying. The memo is always read first, so a lease
// never stands in front of an answer that already exists.

/** Longer than any holder can live: the 300 s function limit on every door. */
export const TRANSCRIPT_LEASE_TTL_MS = 330_000

type TranscriptLease = { v: 1; expires_at: number }

/** The lease's key: the memo's own, one suffix further — `trc/<audio>.<locale>.lease.json`.
 *  It parses as no key kind at all (the grammar's transcript arm needs the
 *  locale last), so no fence anywhere can mistake it for audio or a memo. */
export function transcriptLeaseKey(memoKey: string): string {
  return memoKey.replace(/\.json$/, '.lease.json')
}

/**
 * Try to hold the lease. `held` = this call may pay (it wrote the lease, or
 * took over one that had expired or been released); `busy` = another call is
 * transcribing this audio now, until `until` (epoch ms); `unknown` = storage
 * would not say — the caller pays, exactly as before the lease existed (the
 * memo read's own fail-open rule). Never throws.
 */
export async function takeTranscriptLease(
  memoKey: string,
  now = Date.now(),
): Promise<{ state: 'held' } | { state: 'busy'; until: number } | { state: 'unknown' }> {
  const key = transcriptLeaseKey(memoKey)
  const body = (at: number) => JSON.stringify({ v: 1, expires_at: at } satisfies TranscriptLease)
  try {
    const created = await createServiceClient()
      .storage.from('recordings')
      .upload(key, body(now + TRANSCRIPT_LEASE_TTL_MS), { contentType: 'application/json', upsert: false })
    if (!created.error) return { state: 'held' }
    if (!isDuplicateRefusal(created.error)) {
      warnStorageUnknown('transcript-lease.take', created.error)
      return { state: 'unknown' }
    }
    const until = await readLeaseUntil(key)
    if (until === null) return { state: 'unknown' }
    if (until > now) return { state: 'busy', until }
    // Expired or released: take it over. Two callers taking over one expired
    // lease in the same instant both pay — the fall-open, bounded and stated.
    const taken = await createServiceClient()
      .storage.from('recordings')
      .upload(key, body(now + TRANSCRIPT_LEASE_TTL_MS), { contentType: 'application/json', upsert: true })
    if (taken.error) {
      warnStorageUnknown('transcript-lease.takeover', taken.error)
      return { state: 'unknown' }
    }
    return { state: 'held' }
  } catch (err) {
    warnStorageUnknown('transcript-lease.take', err)
    return { state: 'unknown' }
  }
}

/** Is the lease still live? A missing or unreadable one is not (fail open). */
export async function transcriptLeaseLive(memoKey: string, now = Date.now()): Promise<boolean> {
  const until = await readLeaseUntil(transcriptLeaseKey(memoKey))
  return until !== null && until > now
}

/** Release a lease this call holds — overwritten as already expired, never
 *  deleted. Best-effort and silent on failure: an unreleased lease simply
 *  expires. Never throws. */
export async function releaseTranscriptLease(memoKey: string): Promise<void> {
  try {
    const { error } = await createServiceClient()
      .storage.from('recordings')
      .upload(transcriptLeaseKey(memoKey), JSON.stringify({ v: 1, expires_at: 0 } satisfies TranscriptLease), {
        contentType: 'application/json',
        upsert: true,
      })
    if (error) warnStorageUnknown('transcript-lease.release', error)
  } catch (err) {
    warnStorageUnknown('transcript-lease.release', err)
  }
}

/** The lease's expiry, or null when it cannot be read (missing, garbage, error). */
async function readLeaseUntil(key: string): Promise<number | null> {
  try {
    const { data, error } = await createServiceClient().storage.from('recordings').download(key)
    if (error || !data) {
      if (error && !isStorageNotFound(error)) warnStorageUnknown('transcript-lease.read', error)
      return null
    }
    const lease = JSON.parse(await data.text()) as Partial<TranscriptLease> | null
    return lease?.v === 1 && typeof lease.expires_at === 'number' ? lease.expires_at : null
  } catch (err) {
    warnStorageUnknown('transcript-lease.read', err)
    return null
  }
}
