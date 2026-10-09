import 'server-only'
import { parseStorageTime } from '@/lib/recording/storage-time'
import { createHash, randomUUID } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { isDuplicateRefusal } from '@/lib/recording/storage-duplicate'
import { isStorageNotFound, warnStorageUnknown } from '@/lib/recording/take-binding'
import { TRANSCRIPT_LEASE_CLOCK_SKEW_MS, TRANSCRIPT_LEASE_TTL_MS } from '@/lib/recording/transcript-lease-ttl'

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
 * took over one that had expired, been released or was unusable); `busy` = another call is
 * transcribing this audio now, until `until` (epoch ms); `unknown` = storage
 * would not say — the caller pays, exactly as before the lease existed (the
 * memo read's own fail-open rule). Never throws.
 */
export async function takeTranscriptLease(memoKey: string, now = Date.now()): Promise<TranscriptLeaseTake> {
  const key = transcriptLeaseKey(memoKey)
  const startedAt = Date.now()
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
    // ⚖ S120 (R-S118-7, GPT-6 finding 1): `now` was read before the create. A create
    // that stalled past the skew bound read a live holder's fresh lease as too far
    // ahead and paid beside it, so every judgement from here uses the clock after it.
    now += Date.now() - startedAt
    // ⚖ S120 (G5) — A PRESENT BUT UNUSABLE LEASE IS TAKEN OVER LIKE AN EXPIRED ONE. A
    // body no call could have written (or an impossible expiry) used to answer unknown
    // for ever: never rewritten, every call paid unleased. It now goes through the same
    // claim, keyed by a generation read off its own bytes, so its takers still meet one
    // winner. A read that FAILED (no bytes) still answers unknown, as before.
    const seen = await readLeaseOutcome(key, now)
    if (seen.kind === 'none' || seen.kind === 'error') return { state: 'unknown' }
    if (seen.kind === 'lease' && seen.until > now) return { state: 'busy', until: seen.until }
    // Expired or released: CLAIM this generation first (create-only), so two
    // callers meeting one expired lease cannot both take it over (S114 F-CT-5a).
    // ⚖ S115 (B1) — A DEAD CLAIM CHAINS, IT NEVER STRANDS. A claim whose winner
    // never wrote its lease (it died, or its lease write failed) used to answer
    // busy for ever. A claim older than one TTL with no live lease behind it is
    // now passed over to the NEXT link, `…lease.<that claim's nonce>.claim.json`
    // — the very key a lease written by that winner would claim — create-only
    // again, so each link still has exactly one winner.
    // ⚖ S116 round 4 (SF4) — A FALL-OPEN RE-ROOTS THE CHAIN. Past the link cap, or
    // on a claim storage dates older than one TTL that cannot be read, no lease was
    // ever written, so every arrival paid while that state lasted. The fall-open
    // now writes a fresh lease of its own (upsert) and reads it back, like a
    // takeover: a later arrival sees a live lease and is held off; when it ends,
    // the next generation is a fresh claim keyed by this nonce. Only callers whose
    // re-roots overlap (lease re-read → upsert → read-back) can both hold; one
    // whose write storage refuses answers 'unknown' and pays, as before. It goes
    // through the takeover's own write below (one lease write site).
    let rerooting = false
    let claimKey = transcriptLeaseClaimKey(memoKey, seen.kind === 'lease' ? seen : { until: 0, nonce: seen.generation })
    let theirs: { until: number; nonce?: string } | null | undefined
    for (let link = 0; ; link++) {
      let claim: { error: unknown }
      try {
        claim = await createServiceClient().storage.from('recordings').upload(claimKey, JSON.stringify({ v: 1, at: now, nonce }), { contentType: 'application/json', upsert: false })
      } catch (err) {
        claim = { error: err ?? new Error('claim upload threw') }
      }
      // A non-refusal error may still have landed the claim: read it back
      // instead of paying unclaimed (S115) — ours means we won the link.
      const won = !claim.error || (!isDuplicateRefusal(claim.error) && (await readClaimOk(claimKey, now))?.nonce === nonce)
      if (won) break
      if (!isDuplicateRefusal(claim.error)) {
        warnStorageUnknown('transcript-lease.claim', claim.error)
        return { state: 'busy', until: now + TRANSCRIPT_LEASE_CLAIM_BUSY_MS }
      }
      // Another caller won this link. A live lease behind it = it is transcribing.
      if (theirs === undefined) theirs = await readLease(key, now)
      if (theirs !== null && theirs.until > now) return { state: 'busy', until: theirs.until }
      const read = await readClaim(claimKey, now)
      if (read.kind !== 'ok') {
        // ⚖ S115 round 3 (S2) — AN UNREADABLE CLAIM FALLS OPEN TOO. Its body cannot
        // say its age, so storage's own created_at for the object does (the storage
        // server's clock, not the writer's). Past one TTL the take re-roots (warned): it
        // writes its own lease and answers held ('unknown', an unleased pay, only if that lease write or the first lease read fails). Never a next link named from this key: callers that
        // can and cannot read the claim would chain to two links and both pay.
        // ⚖ S116 round 4 (SF2) — ONLY A PERSISTENT OR INVALID CLAIM GETS HERE: a
        // transient read fault was re-read inside readClaim (CLAIM_READ_ATTEMPTS), so
        // one blip never makes this caller pay unleased beside another that walks on.
        // (SF1) A claim `at` past now + the reader bound is invalid too.
        const born = await claimCreatedAt(claimKey)
        if (born !== null && born + TRANSCRIPT_LEASE_TTL_MS <= now) {
          warnStorageUnknown('transcript-lease.claim-unreadable', null)
          rerooting = true
          break
        }
        return { state: 'busy', until: now + TRANSCRIPT_LEASE_CLAIM_BUSY_MS }
      }
      const winner = read
      if (winner.at + TRANSCRIPT_LEASE_TTL_MS > now) return { state: 'busy', until: now + TRANSCRIPT_LEASE_CLAIM_BUSY_MS }
      // ⚖ S115 round 3 (S1) — PAST THE CAP A DEAD CHAIN FALLS OPEN. The cap only bounds
      // one call's walk (each call wins at most one link, each next link is named by
      // the one winner before it, so the chain cannot loop). Past it, with the last
      // winner dead, the take re-roots (warned): it writes its own lease and answers
      // held ('unknown', an unleased pay, only if that lease write or the first lease read fails) — never busy for ever.
      if (link + 1 >= TRANSCRIPT_LEASE_MAX_LINKS) {
        warnStorageUnknown('transcript-lease.links', null)
        rerooting = true
        break
      }
      claimKey = transcriptLeaseClaimKey(memoKey, { until: 0, nonce: winner.nonce })
    }
    // ⚖ S115 (B1): from here this caller is the ONE winner of its link, and the
    // claim object itself holds the audio for one TTL. A lease write or read-back
    // that storage will not confirm therefore still answers HELD (the caller
    // pays, holding the claim; its release is a no-op and the claim falls open
    // after one TTL) — never 'unknown', which left a payer holding nothing.
    if (rerooting) {
      // ⚖ S116 round 5 (SF-A): a READ ERROR here answers busy, never 「no lease」 — one
      // blip must not overwrite a live holder. A lasting failure already paid above
      // (the first read, `seen === null` → unknown), so this cannot stick.
      const live = await readLeaseOutcome(key, now)
      if (live.kind === 'error') return { state: 'busy', until: now + TRANSCRIPT_LEASE_CLAIM_BUSY_MS }
      if (live.kind === 'lease' && live.until > now) return { state: 'busy', until: live.until }
    }
    let taken: { error: unknown }
    try {
      taken = await createServiceClient().storage.from('recordings').upload(key, body(now + TRANSCRIPT_LEASE_TTL_MS), { contentType: 'application/json', upsert: true })
    } catch (err) {
      taken = { error: err ?? new Error('takeover upload threw') }
    }
    if (taken.error) {
      // A won claim still holds the audio (B1); a re-root holds nothing → unknown.
      warnStorageUnknown(rerooting ? 'transcript-lease.reroot' : 'transcript-lease.takeover', taken.error)
      return rerooting ? { state: 'unknown' } : held()
    }
    // Read back: only the caller whose nonce stands proceeds.
    const after = await readLease(key, now)
    if (after === null) return held()
    if (after.nonce !== nonce) return { state: 'busy', until: after.until > now ? after.until : now + TRANSCRIPT_LEASE_CLAIM_BUSY_MS }
    // ⚖ S120 (G3) — THE GENERATION FENCE. The upsert above is unconditional (storage-js
    // offers only x-upsert, no If-Match), so a write delayed past a later takeover could
    // land and read back as ours. Whoever takes over OUR generation claims the key named
    // by our nonce first: if that claim exists, a newer link holds the audio → busy, our
    // stray lease only makes the next caller wait for that link's claim. Unsure = held (B1).
    if ((await claimExists(transcriptLeaseClaimKey(memoKey, { until: 0, nonce }))) === true) {
      return { state: 'busy', until: now + TRANSCRIPT_LEASE_CLAIM_BUSY_MS }
    }
    return held()
  } catch (err) {
    warnStorageUnknown('transcript-lease.take', err)
    return { state: 'unknown' }
  }
}

/** How long a caller that lost a claim is told to wait when the winner's lease
 *  has not landed yet — an engineering poll hint, not a business duration. */
const TRANSCRIPT_LEASE_CLAIM_BUSY_MS = 5_000

/** ⚖ S115 (B1) — how many dead claim links one take will walk. Each link is a
 *  takeover whose winner never wrote its lease, at least one TTL apart; past
 *  this many in a row, with the last winner dead, the caller pays unleased
 *  ('unknown', warned — S115 round 3, S1). A loop bound, not a business number. */
const TRANSCRIPT_LEASE_MAX_LINKS = 32

/** ⚖ S116 round 4 (SF2) — how many times one take reads a claim whose read
 *  FAILED (a download error, a throw, a body that is not JSON — a truncated
 *  read) before it calls the claim persistently unreadable; the waits between
 *  reads. A retry bound, not a business number. */
const CLAIM_READ_ATTEMPTS = 3
const CLAIM_READ_BACKOFF_MS = [150, 300]

/** What one read of a claim object says (S116 round 4, SF1 + SF2):
 *  `ok` — `{ at, nonce }`, believable;
 *  `invalid` — READABLE but no claim this code could have written: not v 1, an
 *    `at` that is not a finite number or lies past now + the reader bound (SF1),
 *    a nonce outside the generation grammar — deterministic, never re-read;
 *  `unreadable` — every one of CLAIM_READ_ATTEMPTS reads failed (download error,
 *    throw, or a body that is not JSON): persistent, not a blip.
 *  Only `invalid` and `unreadable` go to storage's created_at (the S2 path). */
type ClaimRead = { kind: 'ok'; at: number; nonce: string } | { kind: 'invalid' } | { kind: 'unreadable' }

async function readClaim(key: string, now: number): Promise<ClaimRead> {
  for (let attempt = 0; attempt < CLAIM_READ_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, CLAIM_READ_BACKOFF_MS[attempt - 1]))
    let claim: { v?: unknown; at?: unknown; nonce?: unknown } | null
    try {
      const { data, error } = await createServiceClient().storage.from('recordings').download(key)
      if (error || !data) {
        if (error && !isStorageNotFound(error)) warnStorageUnknown('transcript-lease.claim-read', error)
        continue
      }
      claim = JSON.parse(await data.text()) as typeof claim
    } catch (err) {
      warnStorageUnknown('transcript-lease.claim-read', err)
      continue
    }
    if (claim?.v !== 1 || typeof claim.at !== 'number' || !Number.isFinite(claim.at)) return { kind: 'invalid' }
    if (claim.at > now + LEASE_CLOCK_SKEW_MS) return { kind: 'invalid' }
    if (typeof claim.nonce !== 'string' || !CLAIM_GENERATION_RE.test(claim.nonce)) return { kind: 'invalid' }
    return { kind: 'ok', at: claim.at, nonce: claim.nonce }
  }
  return { kind: 'unreadable' }
}

/** ⚖ S120 (G3) — is there a claim object at `key`? true / false (a 404) / null when
 *  storage will not say. Existence alone: any claim on our generation supersedes us. */
async function claimExists(key: string): Promise<boolean | null> {
  try {
    const { data, error } = await createServiceClient().storage.from('recordings').download(key)
    if (!error && data) return true
    if (error && isStorageNotFound(error)) return false
    warnStorageUnknown('transcript-lease.fence', error)
    return null
  } catch (err) {
    warnStorageUnknown('transcript-lease.fence', err)
    return null
  }
}

/** The claim's `{ at, nonce }` when it reads `ok`, else null. */
async function readClaimOk(key: string, now: number): Promise<{ at: number; nonce: string } | null> {
  const read = await readClaim(key, now)
  return read.kind === 'ok' ? read : null
}

const CLAIM_GENERATION_RE = /^[0-9a-f-]{8,64}$/i

/** ⚖ S115 round 3 (S2) — when storage created a claim object: its own
 *  created_at (storage-js info() → createdAt, declared string), or null when
 *  storage will not say. Read only for a claim whose body cannot be read. */
async function claimCreatedAt(key: string): Promise<number | null> {
  try {
    const { data, error } = await createServiceClient().storage.from('recordings').info(key)
    if (error || !data) {
      // ⚖ S116 round 4 (N4): a 404 here is warned too — the claim's create just
      // met it (409), so storage that cannot find it is inconsistent, not empty.
      if (error) warnStorageUnknown('transcript-lease.claim-info', error)
      return null
    }
    const at = parseStorageTime(data.createdAt)
    if (at === null) warnStorageUnknown('transcript-lease.claim-info', null) // ⚖ S117 (NIT): no usable createdAt
    return at
  } catch (err) {
    warnStorageUnknown('transcript-lease.claim-info', err)
    return null
  }
}

/** The claim object for one lease generation: the lease's own key with the
 *  generation (its nonce; a pre-S114 lease has none, so its expiry) before
 *  `.claim.json`. Parses as no key kind, like the lease. */
export function transcriptLeaseClaimKey(memoKey: string, seen: { until: number; nonce?: string }): string {
  const generation = seen.nonce !== undefined && CLAIM_GENERATION_RE.test(seen.nonce) ? seen.nonce : `t${seen.until}`
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
 *  have written it. A tolerance between clocks, not a business duration.
 *  ⚖ S116 round 4 (SF3): derived beside the TTL — two takeover limits, 60 s. */
const LEASE_CLOCK_SKEW_MS = TRANSCRIPT_LEASE_CLOCK_SKEW_MS

/** The lease's expiry, or null when it cannot be read (missing, garbage, error).
 *  ⚖ S58 — an expiry no call could have written (not a finite number, or past
 *  `now + TRANSCRIPT_LEASE_TTL_MS + LEASE_CLOCK_SKEW_MS`) is unreadable too,
 *  warned: never busy forever (the take takes it over — S120 G5). */
async function readLease(key: string, now: number): Promise<{ until: number; nonce?: string } | null> {
  const read = await readLeaseOutcome(key, now)
  return read.kind === 'lease' ? { until: read.until, ...(read.nonce !== undefined ? { nonce: read.nonce } : {}) } : null
}

/** ⚖ S116 round 5 (SF-A) — readLease, telling WHY there is no lease: `none` = a 404;
 *  `error` = a download error that is not a 404, or a throw.
 *  ⚖ S120 (G5): `unusable` = the download SUCCEEDED but its bytes are no lease this code
 *  could have written (not JSON — storage-js buffers the whole body before it answers,
 *  so these are the stored bytes, not a cut read — not v 1, an expiry that is not a
 *  number or is impossible). Its `generation` is the body's own nonce when it carries
 *  one (the key an expired read of it would claim), else a hash of the bytes. */
async function readLeaseOutcome(
  key: string,
  now: number,
): Promise<{ kind: 'lease'; until: number; nonce?: string } | { kind: 'none' } | { kind: 'error' } | { kind: 'unusable'; generation: string }> {
  try {
    const { data, error } = await createServiceClient().storage.from('recordings').download(key)
    if (error || !data) {
      if (error && !isStorageNotFound(error)) {
        warnStorageUnknown('transcript-lease.read', error)
        return { kind: 'error' }
      }
      return { kind: 'none' }
    }
    const text = await data.text()
    let lease: Partial<TranscriptLease> | null
    try {
      lease = JSON.parse(text) as Partial<TranscriptLease> | null
    } catch {
      lease = null
    }
    const unusable = () => {
      const nonce = (lease as { nonce?: unknown } | null)?.nonce
      const generation = typeof nonce === 'string' && CLAIM_GENERATION_RE.test(nonce) ? nonce : createHash('sha256').update(text).digest('hex')
      return { kind: 'unusable' as const, generation }
    }
    if (lease?.v !== 1 || typeof lease.expires_at !== 'number') return unusable()
    if (!Number.isFinite(lease.expires_at) || lease.expires_at > now + TRANSCRIPT_LEASE_TTL_MS + LEASE_CLOCK_SKEW_MS) {
      warnStorageUnknown('transcript-lease.expiry', null)
      return unusable()
    }
    return { kind: 'lease', until: lease.expires_at, ...(typeof lease.nonce === 'string' ? { nonce: lease.nonce } : {}) }
  } catch (err) {
    warnStorageUnknown('transcript-lease.read', err)
    return { kind: 'error' }
  }
}
