import 'server-only'
import { randomUUID } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { isDuplicateRefusal } from '@/lib/recording/storage-duplicate'
import { isStorageNotFound, warnStorageUnknown } from '@/lib/recording/take-binding'
import { TRANSCRIPT_LEASE_TTL_MS } from '@/lib/recording/transcript-lease-ttl'

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
   *  true-up was owed (see TranscriptTrueUpOwed). Absent = nothing owed, or a
   *  memo written after its true-up had already run (every memo before S56). */
  trueUp?: TranscriptTrueUpOwed
}

/** ⚖ WHAT THE ANSWER OWES THE LEDGER (S56, PR 1 Greptile Finding 1; S57). The
 *  meter writes the memo BEFORE the ledger true-up (S53 A3), so a process that
 *  dies between the two used to leave a memo that replays forever while the
 *  difference between the reserve and the real cost was never recorded. The
 *  memo now carries the debt's numbers, written ONCE with the answer, before
 *  the ledger is asked — and never rewritten (S57, Greptile round 2 on #1086,
 *  finding 2: a rewrite of the whole memo could revert another call's repair
 *  or flip "recorded" back). Whether the debt is RECORDED is not the memo's to
 *  say: that fact has ONE home, the create-only true-up object beside it
 *  (transcriptTrueUpKey / recordTranscriptTrueUp below). A debt the memo names
 *  and no true-up object answers for is owed — the retry trigger, soft and
 *  self-retrying: nothing cleared, nothing deleted. Numbers only — never a
 *  word of the transcript, never a key. */
export type TranscriptTrueUpOwed = {
  reserveCents: number
  costCents: number
  deltaCents: number
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
 * Those are the only two writes a memo ever sees. ⚖ S57: it is NEVER rewritten
 * for its true-up (the S56 `mark` upsert is gone — Greptile round 2 on #1086,
 * finding 2): the debt's numbers are written once, with the answer, and the
 * recorded fact lives in its own create-only object (recordTranscriptTrueUp).
 */
export async function writeTranscriptMemo(
  key: string,
  memo: TranscriptMemo,
  opts: { repair: boolean },
): Promise<TranscriptMemoWrite> {
  try {
    const { error } = await createServiceClient()
      .storage.from('recordings')
      .upload(key, JSON.stringify(memo), {
        contentType: 'application/json',
        upsert: opts.repair,
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

// ⚖ S57 — THE TRUE-UP'S RECORDED FACT: ONE HOME, CREATE-ONLY (Greptile round 2
// on #1086, finding 2, thread PRRT_kwDOSCB5RM6mzfjy: "Mark updates overwrite
// concurrent repairs"). Until S57 the memo itself was rewritten (a whole-object
// upsert) to move its mark to `recorded`, so one call's rewrite could replace
// another call's valid repair, or flip `recorded` back to `pending` and let a
// later replay charge the delta again. Not every memo write is made under the
// lease — a caller that pays when storage will not answer about the lease, a
// caller that pays regardless (a colleague's key), and two callers taking one
// expired lease over at once all write without holding it alone — so the lease
// could not make that rewrite safe. The fact now lives BESIDE the memo in its
// own object, `trc/<audio>.<locale>.trueup.json`: created ONCE, create-only,
// by the call that just had the ledger take the owed delta, and never upserted,
// never deleted. Once it exists the debt is recorded, and nothing can un-record
// it. Numbers only (the delta in cents and when it was recorded) — never a word
// of the transcript, never a key.

type TranscriptTrueUpRecord = { v: 1; deltaCents: number; recorded_at: string }

/** The true-up object's key: the memo's own, one suffix further —
 *  `trc/<audio>.<locale>.trueup.json`. Like the lease's, it parses as no key
 *  kind at all (the grammar's transcript arm needs the locale last). */
export function transcriptTrueUpKey(memoKey: string): string {
  return memoKey.replace(/\.json$/, '.trueup.json')
}

/** Is this audio's owed true-up recorded? `recorded` = the object exists (its
 *  existence IS the fact); `absent` = storage says there is none; `unknown` =
 *  storage would not say (warned once) — the caller never records on that.
 *  Never throws. */
export async function readTranscriptTrueUp(memoKey: string): Promise<'recorded' | 'absent' | 'unknown'> {
  try {
    const { data, error } = await createServiceClient().storage.from('recordings').download(transcriptTrueUpKey(memoKey))
    if (!error && data) return 'recorded'
    if (error && isStorageNotFound(error)) return 'absent'
    warnStorageUnknown('transcript-trueup.read', error ?? null)
    return 'unknown'
  } catch (err) {
    warnStorageUnknown('transcript-trueup.read', err)
    return 'unknown'
  }
}

/** Write down that the ledger took this audio's owed true-up — create-only,
 *  never upserted. `taken` = it was already recorded (another call recorded a
 *  true-up for this audio too — possible only where the lease fell open; one
 *  line says so); `failed` = storage would not take it (warned). Its callers
 *  (transcribe.ts markTrueUpRecorded, S58) retry a failed write once, then
 *  file the receipt at warning (`debit_mark: 'failed'`): the debt still reads
 *  as owed, and a later replay under the lease records it AGAIN — once per
 *  replay, until the marker can be written — an over-count, the safe
 *  direction, closable only by an idempotency key on the usage writer (the
 *  queued core ask). Never throws. */
export async function recordTranscriptTrueUp(memoKey: string, deltaCents: number): Promise<TranscriptMemoWrite> {
  const record: TranscriptTrueUpRecord = { v: 1, deltaCents, recorded_at: new Date().toISOString() }
  try {
    const { error } = await createServiceClient()
      .storage.from('recordings')
      .upload(transcriptTrueUpKey(memoKey), JSON.stringify(record), {
        contentType: 'application/json',
        upsert: false,
      })
    if (!error) return 'written'
    if (isDuplicateRefusal(error)) {
      console.warn('[ai-usage] a transcription true-up was already recorded for this audio (a second recorder: the lease fell open)')
      return 'taken'
    }
    warnStorageUnknown('transcript-trueup.write', error)
    return 'failed'
  } catch (err) {
    warnStorageUnknown('transcript-trueup.write', err)
    return 'failed'
  }
}

// ⚖ S53 A5 — THE "TRANSCRIBING NOW" LEASE (transcribe.ts reserved "a
// create-only lease object with a TTL" to Liam's word; ruling given — Liam,
// 2026-09-28 19:5x JST: 「I think both. Yes to both.」).
// The memo is written AFTER the money moves, so two calls on the same audio
// inside the provider at once both missed it and both paid (a retry 1.5 s
// after a dropped connection, a quick 再試行 tap). The lease is written BEFORE
// the reserve, beside the memo in the same bucket — a storage object, never a
// database row — and names only when it stops counting. It is never deleted:
// the holder RELEASES it (overwrites it as already expired) when its call
// ends, whatever the outcome; a holder that died leaves it until it expires,
// and expiry falls open to paying. The memo is always read first, so a lease
// never stands in front of an answer that already exists.

// ⚖ S114 (F-CT-5) — the lease carries its holder's NONCE. A takeover of an
// expired or released lease first CLAIMS that lease generation with a
// create-only object (trc/<audio>.<locale>.lease.<generation>.claim.json — the
// same bucket's unique-name refusal the lease itself relies on, no table),
// then writes its own lease and reads it back: only the caller whose nonce
// reads back holds it. Release overwrites only a lease that still names this
// caller's nonce and has not expired.
type TranscriptLease = { v: 1; expires_at: number; nonce?: string }

declare const HELD: unique symbol
/** ⚖ S57 — PROOF THAT THIS CALL HOLDS THE LEASE on `memoKey`. Only
 *  takeTranscriptLease makes one (the brand cannot be written anywhere else
 *  without a cast), so a function that takes it as a parameter cannot be
 *  called by a caller that did not win the lease — the replay's true-up
 *  recorder in ai/transcribe.ts (Greptile round 2 on #1086, finding 1). */
export type HeldTranscriptLease = { readonly memoKey: string; readonly nonce: string; readonly [HELD]: true }

/** What one take of the lease answered (see takeTranscriptLease). */
export type TranscriptLeaseTake =
  | { state: 'held'; lease: HeldTranscriptLease }
  | { state: 'busy'; until: number }
  | { state: 'unknown' }

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
export async function takeTranscriptLease(memoKey: string, now = Date.now()): Promise<TranscriptLeaseTake> {
  const key = transcriptLeaseKey(memoKey)
  const nonce = randomUUID()
  const held = (): TranscriptLeaseTake => ({ state: 'held', lease: { memoKey, nonce } as HeldTranscriptLease })
  const body = (at: number) => JSON.stringify({ v: 1, expires_at: at, nonce } satisfies TranscriptLease)
  try {
    const created = await createServiceClient().storage.from('recordings').upload(key, body(now + TRANSCRIPT_LEASE_TTL_MS), { contentType: 'application/json', upsert: false })
    if (!created.error) return held()
    if (!isDuplicateRefusal(created.error)) {
      warnStorageUnknown('transcript-lease.take', created.error)
      return { state: 'unknown' }
    }
    const seen = await readLease(key, now)
    if (seen === null) return { state: 'unknown' }
    if (seen.until > now) return { state: 'busy', until: seen.until }
    // Expired or released: CLAIM this generation first (create-only), so two
    // callers meeting one expired lease cannot both take it over (S114 F-CT-5a).
    const claim = await createServiceClient().storage.from('recordings').upload(
      transcriptLeaseClaimKey(memoKey, seen),
      JSON.stringify({ v: 1, at: now, nonce }),
      { contentType: 'application/json', upsert: false },
    )
    if (claim.error) {
      if (!isDuplicateRefusal(claim.error)) {
        warnStorageUnknown('transcript-lease.claim', claim.error)
        return { state: 'unknown' }
      }
      // Another caller won this generation: it is transcribing now.
      const theirs = await readLease(key, now)
      return { state: 'busy', until: theirs !== null && theirs.until > now ? theirs.until : now + TRANSCRIPT_LEASE_CLAIM_BUSY_MS }
    }
    const taken = await createServiceClient().storage.from('recordings').upload(key, body(now + TRANSCRIPT_LEASE_TTL_MS), { contentType: 'application/json', upsert: true })
    if (taken.error) {
      warnStorageUnknown('transcript-lease.takeover', taken.error)
      return { state: 'unknown' }
    }
    // Read back: only the caller whose nonce stands proceeds.
    const after = await readLease(key, now)
    if (after === null) return { state: 'unknown' }
    if (after.nonce !== nonce) return { state: 'busy', until: after.until > now ? after.until : now + TRANSCRIPT_LEASE_CLAIM_BUSY_MS }
    return held()
  } catch (err) {
    warnStorageUnknown('transcript-lease.take', err)
    return { state: 'unknown' }
  }
}

/** How long a caller that lost a claim is told to wait when the winner's lease
 *  has not landed yet — an engineering poll hint, not a business duration. */
const TRANSCRIPT_LEASE_CLAIM_BUSY_MS = 5_000

/** The claim object for one lease generation: the lease's own key with the
 *  generation (its nonce; a pre-S114 lease has none, so its expiry) before
 *  `.claim.json`. Parses as no key kind, like the lease. */
export function transcriptLeaseClaimKey(memoKey: string, seen: { until: number; nonce?: string }): string {
  const generation = seen.nonce !== undefined && /^[0-9a-f-]{8,64}$/i.test(seen.nonce) ? seen.nonce : `t${seen.until}`
  return transcriptLeaseKey(memoKey).replace(/\.lease\.json$/, `.lease.${generation}.claim.json`)
}

/** Is the lease still live? A missing or unreadable one is not (fail open). */
export async function transcriptLeaseLive(memoKey: string, now = Date.now()): Promise<boolean> {
  const seen = await readLease(transcriptLeaseKey(memoKey), now)
  return seen !== null && seen.until > now
}

/** Release a lease this call holds — overwritten as already expired (keeping
 *  its nonce, so the next takeover claims a fresh generation), never deleted.
 *  ⚖ S114 (F-CT-5b): ONLY YOUR OWN — the lease is read first and left alone
 *  unless it still names `held`'s nonce and has not expired (an expired lease
 *  already falls open; overwriting it could only erase a newer holder's).
 *  Best-effort and silent on failure: an unreleased lease simply expires.
 *  Never throws. */
export async function releaseTranscriptLease(held: HeldTranscriptLease, now = Date.now()): Promise<void> {
  try {
    const key = transcriptLeaseKey(held.memoKey)
    const seen = await readLease(key, now)
    if (seen === null || seen.nonce !== held.nonce || seen.until <= now) return
    const { error } = await createServiceClient()
      .storage.from('recordings')
      .upload(key, JSON.stringify({ v: 1, expires_at: 0, nonce: held.nonce } satisfies TranscriptLease), {
        contentType: 'application/json',
        upsert: true,
      })
    if (error) warnStorageUnknown('transcript-lease.release', error)
  } catch (err) {
    warnStorageUnknown('transcript-lease.release', err)
  }
}

/** ⚖ S58 — the clock-skew tolerance on a lease's expiry: how far past this
 *  server's own `now + TRANSCRIPT_LEASE_TTL_MS` another server's clock may
 *  have written it. A tolerance between clocks, not a business duration. */
const LEASE_CLOCK_SKEW_MS = 60_000

/** The lease's expiry, or null when it cannot be read (missing, garbage, error).
 *  ⚖ S58 — an expiry no call could have written (not a finite number, or past
 *  `now + TRANSCRIPT_LEASE_TTL_MS + LEASE_CLOCK_SKEW_MS`) is unreadable too,
 *  warned: it falls open to paying, never busy forever. */
async function readLease(key: string, now: number): Promise<{ until: number; nonce?: string } | null> {
  try {
    const { data, error } = await createServiceClient().storage.from('recordings').download(key)
    if (error || !data) {
      if (error && !isStorageNotFound(error)) warnStorageUnknown('transcript-lease.read', error)
      return null
    }
    const lease = JSON.parse(await data.text()) as Partial<TranscriptLease> | null
    if (lease?.v !== 1 || typeof lease.expires_at !== 'number') return null
    if (!Number.isFinite(lease.expires_at) || lease.expires_at > now + TRANSCRIPT_LEASE_TTL_MS + LEASE_CLOCK_SKEW_MS) {
      warnStorageUnknown('transcript-lease.expiry', null)
      return null
    }
    return { until: lease.expires_at, ...(typeof lease.nonce === 'string' ? { nonce: lease.nonce } : {}) }
  } catch (err) {
    warnStorageUnknown('transcript-lease.read', err)
    return null
  }
}
