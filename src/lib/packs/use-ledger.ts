// THE USE LEDGER (消化の控え) — design v4.2 (build-s123/DESIGN-FAILED-USE-NEVER-LOST-S123-v4.2.md).
// ONE home: the table pack_use_intents in Karute's OWN Supabase project
// (supabase/migrations/20261010101500_pack_use_intents.sql), the six rules
// R1–R6, the state machine, the lease, the ONE classification map, the R4
// pre-read, the settle pass and the ledger-aware usage numbers.
//
// A ticket use is never lost once Karute has it: every server path writes the
// gesture here FIRST (R1), sends the ROW's frozen payload under the row id as
// core's Idempotency-Key, and anything core does not answer provably stays
// pending for the settle pass. Nothing is deleted (⚖ 9/16); every transition is
// a conditional UPDATE … WHERE state = <prior state> (zero rows = a lost race).
// ⚖ no hardcoded durations: every threshold below is ONE named export.

import { addRedemptionWithClient, findCustomerAppointmentForDateWithClient, type AddRedemptionFailure } from '@/lib/packs/store'
import { ymdInJst } from '@/lib/date/jst'
import type { SynqedClient } from '@synqed-kk/client'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Named constants (§ 2) ────────────────────────────────────────────────────
/** core idempotency.service.ts stale-claim takeover window (60 s today). */
export const CORE_STALE_CLAIM_MS = 60_000
/** The longest caller's maxDuration (auto-burn / facade routes: 300 s). */
export const MAX_CALLER_DURATION_MS = 300_000
/** R5: never re-send a key whose unanswered attempt is younger than this. */
export const REPLAY_LEASE_MS = CORE_STALE_CLAIM_MS + MAX_CALLER_DURATION_MS
/** R6: the oldest client gesture_at the server accepts (a device-held gesture). */
export const MAX_HOLD_MS = 7 * 24 * 60 * 60 * 1000
/** R6: how far ahead of the server clock a client gesture_at may be. */
export const CLOCK_SKEW_MS = 5 * 60 * 1000
/** § 5a: the settle pass's own budget inside the auto-burn route (300 s). */
export const SETTLE_BUDGET_MS = 120_000
/** § 5a: bounded parallel core calls in one settle pass. */
export const SETTLE_CONCURRENCY = 8
/** § 5a: rows read per business per pass (the partial index, oldest first). */
export const SETTLE_ROWS_PER_BUSINESS = 200
/** § 5a: a row still pending this long at the daily pass is parked. */
export const PARK_AFTER_MS = 24 * 60 * 60 * 1000
/** § 7: business ids named in a rolled-up alarm. */
export const ALARM_TOP_N = 10
/** 503 IDEMPOTENT_IN_FLIGHT without a Retry-After: wait this long. */
export const IN_FLIGHT_RETRY_DEFAULT_MS = 5_000
/** R4/H12: the ledger deploy day (JST), from KARUTE_LEDGER_CUTOVER_DAY — set it
 *  to the deploy day. Core rows dated AFTER it can only be ledgered uses or
 *  unclaimed-by-construction rows; the day itself is excluded because no core
 *  read returns created_at (C5 would allow it). NO fallback (S126 hole 5: a
 *  silent default adopts a pre-deploy core row). Read lazily inside the attempt,
 *  never at import: mutations.ts imports this module, and a bad env must not take
 *  down the cancel/no-show routes. Unset or malformed = null → the R4 pre-read
 *  keeps the intent pending + alarm 'ledger.cutover_unset'. jest.config.ts sets
 *  one fixed day for the tests. */
export function cutoverDay(): string | null {
  const v = process.env.KARUTE_LEDGER_CUTOVER_DAY?.trim()
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const t = Date.parse(`${v}T12:00:00+09:00`)
  return Number.isFinite(t) && ymdInJst(new Date(t)) === v ? v : null
}
/** The pre-read's answer when cutoverDay() is null: the attempt keeps the row pending + alarm. */
class CutoverUnsetError extends Error {}

// ── Row + store port ─────────────────────────────────────────────────────────
export type IntentState = 'held' | 'pending' | 'parked' | 'settled' | 'refused' | 'withdrawn'
export type LedgerSource = 'manual' | 'no_show' | 'cancel' | 'recovery' | 'backfill' | 'auto'
export type CoreSource = 'manual' | 'backfill' | 'auto'
const OPEN: IntentState[] = ['held', 'pending', 'parked']

export interface CorePayload {
  pack_id: string
  customer_id: string
  redeemed_on: string
  appointment_id: string | null
  karute_record_id: string | null
  source: CoreSource
  created_by: string | null
  counts_as_visit?: boolean
}

export interface IntentRow {
  id: string
  business_id: string
  owner_user_id: string | null
  kind: 'use' | 'undo'
  ledger_source: LedgerSource
  core_source: CoreSource
  customer_id: string
  pack_id: string | null
  pack_picked_by: 'staff' | 'system'
  appointment_id: string | null
  appointment_resolved: boolean
  gesture_at: string
  gesture_at_client: string | null
  clock_suspect: boolean
  redeemed_on: string
  counts_as_visit: boolean | null
  another_session: boolean
  target_redemption_id?: string | null
  frozen_payload: CorePayload | null
  /** R3-pick: the body actually sent after a system re-pick (frozen_payload stays as written). */
  repick_payload?: CorePayload | null
  repicked_from?: string | null
  audit_payload: Record<string, unknown> | null
  created_at?: string
  state: IntentState
  attempts: number
  last_attempt_at?: string | null
  leased_until?: string | null
  last_error_code?: string | null
  last_error_status?: number | null
  last_error_text?: string | null
  settled_core_id?: string | null
  settled_at?: string | null
  refused_at?: string | null
  refused_code?: string | null
  parked_at?: string | null
  parked_reason?: string | null
  resumed_at?: string | null
  held_at?: string | null
  held_against?: string | null
  withdraw_requested_at?: string | null
  withdrawn_at?: string | null
  withdrawn_by?: string | null
  resolved_by?: string | null
  staff_resolution?: string | null
  last_alarmed_at?: string | null
  undone_by?: string | null
}

/** The CAS condition of one transition: the exact prior state, plus (for the
 *  lease) the attempts seen and "lease free at this instant". */
export interface Where {
  state: IntentState
  attempts?: number
  leaseFreeAt?: string
}

export interface LedgerStore {
  /** INSERT … ON CONFLICT (business_id, id) DO NOTHING. */
  insertIgnore(row: IntentRow): Promise<void>
  /** Every row carrying this id, in ANY business (the tenancy check). */
  getAllById(id: string): Promise<IntentRow[]>
  /** One conditional UPDATE … RETURNING; null = zero rows (a lost race). */
  update(businessId: string, id: string, where: Where, patch: Partial<IntentRow>): Promise<IntentRow | null>
  /** Index 2: held/pending/parked/refused rows with staff_resolution null. */
  listForCustomers(businessId: string, customerIds: string[]): Promise<IntentRow[]>
  /** Index 1: open rows of one business, oldest first. */
  listOpen(businessId: string, states: IntentState[], limit: number): Promise<IntentRow[]>
  /** Index 1: the businesses that have open rows. */
  listOpenBusinessIds(states: IntentState[]): Promise<string[]>
  /** Which of these core ids some intent already claimed (settled_core_id). */
  claimedCoreIds(businessId: string, coreIds: string[]): Promise<Set<string>>
}

const T = 'pack_use_intents'
const IN_CHUNK = 200
/** Ids per page of the distinct-business read. */
export const BUSINESS_PAGE = 1000

function fail(error: { message: string } | null): void {
  if (error) throw new Error(`[use-ledger] ${error.message}`)
}

/** The Supabase (service-role) adapter. RLS has no policy; this is the only reader. */
export function supabaseLedgerStore(db: SupabaseClient): LedgerStore {
  return {
    async insertIgnore(row) {
      const { error } = await db.from(T).upsert(row, { onConflict: 'business_id,id', ignoreDuplicates: true })
      fail(error)
    },
    async getAllById(id) {
      const { data, error } = await db.from(T).select('*').eq('id', id)
      fail(error)
      return (data ?? []) as IntentRow[]
    },
    async update(businessId, id, where, patch) {
      let q = db.from(T).update(patch).eq('business_id', businessId).eq('id', id).eq('state', where.state)
      if (where.attempts !== undefined) q = q.eq('attempts', where.attempts)
      if (where.leaseFreeAt) q = q.or(`leased_until.is.null,leased_until.lt."${where.leaseFreeAt}"`)
      const { data, error } = await q.select('*')
      fail(error)
      return ((data ?? []) as IntentRow[])[0] ?? null
    },
    async listForCustomers(businessId, customerIds) {
      const out: IntentRow[] = []
      for (let i = 0; i < customerIds.length; i += IN_CHUNK) {
        const { data, error } = await db.from(T).select('*').eq('business_id', businessId)
          .in('customer_id', customerIds.slice(i, i + IN_CHUNK))
          .in('state', [...OPEN, 'refused']).is('staff_resolution', null)
        fail(error)
        out.push(...((data ?? []) as IntentRow[]))
      }
      return out
    },
    async listOpen(businessId, states, limit) {
      const { data, error } = await db.from(T).select('*').eq('business_id', businessId)
        .in('state', states).order('created_at', { ascending: true }).limit(limit)
      fail(error)
      return (data ?? []) as IntentRow[]
    },
    async listOpenBusinessIds(states) {
      // DISTINCT business_id on the open-row predicate, paginated by key
      // (business_id > the last one seen): never a full-row read, and each page
      // reads at most BUSINESS_PAGE ids (PostgREST has no DISTINCT; the table
      // carries no function by design).
      const out: string[] = []
      let after: string | null = null
      for (;;) {
        let q = db.from(T).select('business_id').in('state', states).order('business_id', { ascending: true }).limit(BUSINESS_PAGE)
        if (after) q = q.gt('business_id', after)
        const { data, error } = await q
        fail(error)
        const ids = ((data ?? []) as Array<{ business_id: string }>).map((r) => r.business_id)
        if (ids.length === 0) return out
        for (const id of ids) if (out[out.length - 1] !== id) out.push(id)
        after = ids[ids.length - 1]
        if (ids.length < BUSINESS_PAGE) return out
      }
    },
    async claimedCoreIds(businessId, coreIds) {
      const out = new Set<string>()
      for (let i = 0; i < coreIds.length; i += IN_CHUNK) {
        const { data, error } = await db.from(T).select('settled_core_id').eq('business_id', businessId)
          .in('settled_core_id', coreIds.slice(i, i + IN_CHUNK))
        fail(error)
        for (const r of (data ?? []) as Array<{ settled_core_id: string }>) out.add(r.settled_core_id)
      }
      return out
    },
  }
}

/** The default store: Karute's own project through the service-role client. */
export async function defaultLedgerStore(): Promise<LedgerStore> {
  const { createServiceClient } = await import('@/lib/supabase/service')
  return supabaseLedgerStore(createServiceClient())
}

/** The web server action's ledger: the store + the cookie session's business. */
export async function defaultLedgerContext(): Promise<{ store: LedgerStore; businessId: string; ownerUserId: string | null }> {
  const [{ getBusinessId }, store] = await Promise.all([import('@/lib/staff'), defaultLedgerStore()])
  return { store, businessId: await getBusinessId(), ownerUserId: null }
}

// ── § 7 the alarm: ONE writer (structured log; the ⚖ 9/30 black box replaces
// the body, never the callers) ───────────────────────────────────────────────
export interface FailureReport {
  product: 'karute'
  kind: string
  business_id: string | null
  ref?: string
  facts?: Record<string, unknown>
}
export function reportFailure(r: FailureReport): void {
  console.error('[alarm]', JSON.stringify(r))
  // The app's existing Sentry client (src/instrumentation.ts initialises it
  // server-side); the intent id rides as a tag. An alarm must never break a use.
  void import('@sentry/nextjs')
    .then((Sentry) => {
      Sentry.captureMessage(`[karute] ${r.kind}`, {
        level: 'error',
        tags: { product: r.product, kind: r.kind, business_id: r.business_id ?? 'none', intent_id: r.ref ?? 'none' },
        extra: r.facts,
      })
    })
    .catch(() => {})
}

// ── R6 gesture_at ─────────────────────────────────────────────────────────────
export function acceptGestureAt(
  client: string | null | undefined,
  now: Date,
): { gestureAt: string; clockSuspect: boolean; gestureAtClient: string | null } {
  const t = client ? Date.parse(client) : Number.NaN
  const n = now.getTime()
  if (Number.isFinite(t) && t >= n - MAX_HOLD_MS && t <= n + CLOCK_SKEW_MS) {
    return { gestureAt: new Date(t).toISOString(), clockSuspect: false, gestureAtClient: null }
  }
  return { gestureAt: now.toISOString(), clockSuspect: Boolean(client), gestureAtClient: client ?? null }
}

// ── R3 the ONE classification map ────────────────────────────────────────────
export type Classified =
  | { kind: 'refused'; code: string }
  | { kind: 'booked_duplicate' }
  | { kind: 'pending'; code: string; status: number | null; retryAfterMs: number | null; answered: boolean; alarm: boolean }

/** The named final refusals: core status + EXACT message (C4 adds `code`). */
const REFUSED_PAIRS: ReadonlyArray<readonly [number, string, string]> = [
  [409, 'Pack has no remaining units', 'no_units'],
  [400, 'Pack not found in this business', 'pack_not_found'],
  [400, 'Visitor is not linked to the pack holder', 'visitor_not_linked'],
  [400, 'Appointment must belong to the actual visitor', 'appointment_mismatch'],
  [400, 'Invalid appointment id', 'invalid_appointment_id'],
  [400, 'Invalid karute record id', 'invalid_karute_record_id'],
  [400, 'Karute record must belong to the actual visitor', 'karute_record_mismatch'],
  [409, 'Shared pack is not active', 'shared_pack_inactive'],
]

export function classifyCoreFailure(f: AddRedemptionFailure, booked: boolean): Classified {
  const status = f.status ?? null
  const message = f.message ?? ''
  for (const [s, m, code] of REFUSED_PAIRS) if (status === s && message === m) return { kind: 'refused', code }
  const body = f.body ?? null
  // core's validation 400 (zod) is `{ error: issues[0].message }`, a STRING
  // (core:src/routes/packs.ts:61-62, read by the S126 attack); the array shapes
  // stay for any route that sends them. Every core 400 on this route is
  // deterministic → final (refused, shown 未消化（要確認）), never endless pending.
  if (status === 400 && body && (typeof body.error === 'string' || Array.isArray(body.issues) || Array.isArray(body.error))) {
    return { kind: 'refused', code: 'invalid_body' }
  }
  // the trigger raise the design names (500 'over-redeemed' / 23514); the store's
  // below_zero discriminator is that same match, kept when no status survived
  if ((status === 500 && /over-redeemed|23514/.test(message)) || (status === null && f.error === 'below_zero')) {
    return { kind: 'refused', code: 'no_units' }
  }
  if (booked && status === 500 && /P2002|23505|pack_redemptions_active_appointment_unique/.test(message)) {
    return { kind: 'booked_duplicate' }
  }
  // core's in-flight answer = 503 + body { error, code: 'IDEMPOTENT_IN_FLIGHT' } +
  // header Retry-After: 1 (core:src/routes/packs.ts:81-86; proven by the S126
  // attack — do not re-verify). The SDK reads `code` from body.code and cannot
  // see the header, so IN_FLIGHT_RETRY_DEFAULT_MS normally applies.
  const code = f.code ?? (typeof body?.code === 'string' ? body.code : null)
  if (status === 503 && code === 'IDEMPOTENT_IN_FLIGHT') {
    const ra = Number(body?.retry_after ?? body?.retryAfter)
    return {
      kind: 'pending', code: 'idempotent_in_flight', status, answered: true, alarm: false,
      retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : IN_FLIGHT_RETRY_DEFAULT_MS,
    }
  }
  return {
    kind: 'pending', code: code ?? (status ? `http_${status}` : 'network'), status,
    retryAfterMs: null, answered: status !== null, alarm: true,
  }
}

// ── R4 the pre-read ──────────────────────────────────────────────────────────
export interface CoreRow {
  id: string
  customer_id: string
  appointment_id: string | null
  redeemed_on: string
  source: string
}
const day = (s: string) => s.slice(0, 10)

/** Window = min(frozen redeemed_on, gesture day) → today. Returns the core row
 *  this intent should settle to, or null (only then may it be sent). */
export function preReadMatch(intent: IntentRow, rows: CoreRow[], claimed: Set<string>, today: string, cutover: string): string | null {
  const gestureDay = ymdInJst(new Date(intent.gesture_at))
  const start = intent.redeemed_on < gestureDay ? intent.redeemed_on : gestureDay
  const inWindow = rows.filter(
    (r) => r.customer_id === intent.customer_id && day(r.redeemed_on) >= start && day(r.redeemed_on) <= today && !claimed.has(r.id),
  )
  if (intent.appointment_id) {
    const own = inWindow.find((r) => r.appointment_id === intent.appointment_id)
    if (own) return own.id
    const nullRow = inWindow.find(
      (r) => r.appointment_id === null && day(r.redeemed_on) > cutover && !['qr', 'pos', 'import'].includes(r.source),
    )
    return nullRow?.id ?? null
  }
  const walk = inWindow.filter((r) => r.appointment_id === null && (r.source === 'manual' || r.source === 'backfill'))
  const preCutover = intent.redeemed_on < cutover
  const m = walk.find((r) => day(r.redeemed_on) > cutover || (preCutover && day(r.redeemed_on) === intent.redeemed_on))
  return m?.id ?? null
}

async function runPreRead(synqed: Pick<SynqedClient, 'packs'>, store: LedgerStore, row: IntentRow, now: Date): Promise<string | null> {
  const cutover = cutoverDay()
  if (!cutover) throw new CutoverUnsetError('KARUTE_LEDGER_CUTOVER_DAY unset or not a JST yyyy-mm-dd')
  const gestureDay = ymdInJst(new Date(row.gesture_at))
  const start = row.redeemed_on < gestureDay ? row.redeemed_on : gestureDay
  const since = ymdInJst(new Date(Date.parse(`${start}T00:00:00+09:00`) - 86_400_000))
  const rows = (await synqed.packs.listRecentRedemptions(since)) as unknown as CoreRow[]
  const mine = rows.filter((r) => r.customer_id === row.customer_id)
  const claimed = await store.claimedCoreIds(row.business_id, mine.map((r) => r.id))
  return preReadMatch(row, mine, claimed, ymdInJst(now), cutover)
}

// ── R2 booking lookup that never turns an error into "no booking" (H15) ──────
export async function lookupAppointmentForDay(
  synqed: Pick<SynqedClient, 'appointments'>,
  customerId: string,
  dateYmd: string,
): Promise<string | null | 'unknown'> {
  // the store's ONE lookup (store.ts), which answers 'unknown' on error (H15)
  try {
    return await findCustomerAppointmentForDateWithClient(synqed, customerId, dateYmd)
  } catch {
    return 'unknown'
  }
}

// ── The attempt (R2 + R4 + R5 + R3 inside, every time) ──────────────────────
export type Precheck = { ok: true } | { withdraw: string } | { refuse: string }
export interface AttemptDeps {
  store: LedgerStore
  synqed: Pick<SynqedClient, 'packs' | 'appointments'>
  now?: () => Date
  /** R2: the path's pre-checks, re-run inside EVERY attempt. A throw = pending. */
  precheck?: (row: IntentRow) => Promise<Precheck>
  /** R3-pick: a SYSTEM-picked pack's next candidate (excluding `tried`). */
  repick?: (row: IntentRow, tried: Set<string>) => Promise<string | null>
}

const iso = (d: Date) => d.toISOString()
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms).toISOString()

async function reread(store: LedgerStore, row: IntentRow): Promise<IntentRow> {
  return (await store.getAllById(row.id)).find((r) => r.business_id === row.business_id) ?? row
}

async function settleTo(store: LedgerStore, row: IntentRow, coreId: string, now: Date, by: string): Promise<IntentRow> {
  try {
    const done = await store.update(row.business_id, row.id, { state: 'pending' }, {
      state: 'settled', settled_core_id: coreId, settled_at: iso(now), resolved_by: by, leased_until: null,
    })
    return done ?? (await reread(store, row))
  } catch {
    // the one-claim unique index (another intent took this core row) — re-read, stay pending
    return reread(store, row)
  }
}

async function keepPending(store: LedgerStore, row: IntentRow, patch: Partial<IntentRow>): Promise<IntentRow> {
  return (await store.update(row.business_id, row.id, { state: 'pending' }, patch)) ?? (await reread(store, row))
}

export async function attemptIntent(deps: AttemptDeps, start: IntentRow): Promise<IntentRow> {
  const { store, synqed } = deps
  const now = (deps.now ?? (() => new Date()))()
  if (start.state !== 'pending') return start
  // R5 — the lease, ONE conditional UPDATE … RETURNING, before any core call.
  const row = await store.update(start.business_id, start.id,
    { state: 'pending', attempts: start.attempts, leaseFreeAt: iso(now) },
    { attempts: start.attempts + 1, last_attempt_at: iso(now), leased_until: plus(now, REPLAY_LEASE_MS) })
  if (!row) return reread(store, start) // no lease → answer from the row, no core call
  const replay = start.attempts > 0
  try {
    if (replay || row.withdraw_requested_at) {
      const match = await runPreRead(synqed, store, row, now)
      if (match) return settleTo(store, row, match, now, `matched:${match}`)
      if (row.withdraw_requested_at) {
        return (await store.update(row.business_id, row.id, { state: 'pending' }, {
          state: 'withdrawn', withdrawn_at: iso(now), withdrawn_by: 'system', leased_until: null,
        })) ?? (await reread(store, row))
      }
    }
    let cur = row
    if (!cur.appointment_resolved) {
      const appt = await lookupAppointmentForDay(synqed, cur.customer_id, cur.redeemed_on)
      if (appt === 'unknown') return keepPending(store, cur, { leased_until: null, last_error_code: 'booking_lookup_unknown' })
      // frozen_payload is written ONCE, here, on the first successful lookup
      const draft = cur.audit_payload?.draft_payload as CorePayload | undefined
      cur = (await store.update(cur.business_id, cur.id, { state: 'pending' }, {
        appointment_id: appt, appointment_resolved: true,
        frozen_payload: draft ? { ...draft, appointment_id: appt } : null,
      })) ?? cur
    }
    const pre = deps.precheck ? await deps.precheck(cur) : ({ ok: true } as const)
    if ('withdraw' in pre) {
      return (await store.update(cur.business_id, cur.id, { state: 'pending' }, {
        state: 'withdrawn', withdrawn_at: iso(now), withdrawn_by: 'system', last_error_code: pre.withdraw, leased_until: null,
      })) ?? (await reread(store, cur))
    }
    if ('refuse' in pre) return refuse(store, cur, pre.refuse, now)
    const tried = new Set<string>()
    for (;;) {
      const p = cur.repick_payload ?? cur.frozen_payload
      if (!p) return keepPending(store, cur, { leased_until: null, last_error_code: 'no_payload' })
      tried.add(p.pack_id)
      const res = await addRedemptionWithClient(synqed, {
        packId: p.pack_id, customerId: p.customer_id, redeemedOn: p.redeemed_on, appointmentId: p.appointment_id,
        karuteRecordId: p.karute_record_id, source: p.source, createdBy: p.created_by,
        ...(p.counts_as_visit === undefined ? {} : { countsAsVisit: p.counts_as_visit }),
        idempotencyKey: cur.id,
      })
      if (res.ok) return settleTo(store, cur, res.id, now, 'system')
      const c = classifyCoreFailure(res, Boolean(p.appointment_id))
      const err = { last_error_status: res.status ?? null, last_error_text: res.message ?? res.error }
      if (c.kind === 'booked_duplicate') {
        const match = await runPreRead(synqed, store, cur, now)
        if (match) return settleTo(store, cur, match, now, `matched:${match}`)
        return keepPending(store, cur, { ...err, last_error_code: 'booked_duplicate_unmatched', leased_until: null })
      }
      if (c.kind === 'refused') {
        if (c.code === 'no_units' && cur.pack_picked_by === 'system' && deps.repick) {
          const next = await deps.repick(cur, tried)
          if (next && !tried.has(next)) {
            cur = (await store.update(cur.business_id, cur.id, { state: 'pending' }, {
              pack_id: next, repicked_from: cur.pack_id, repick_payload: { ...p, pack_id: next },
            })) ?? cur
            continue
          }
        }
        return refuse(store, cur, c.code, now, err)
      }
      if (c.alarm) {
        reportFailure({ product: 'karute', kind: 'ledger.attempt_unproven', business_id: cur.business_id, ref: cur.id, facts: { code: c.code, status: c.status } })
      }
      return keepPending(store, cur, {
        ...err, last_error_code: c.code,
        // answered → the key is free again (core released it); unanswered → keep the lease (R5)
        leased_until: c.retryAfterMs ? plus(now, c.retryAfterMs) : c.answered ? null : cur.leased_until,
      })
    }
  } catch (e) {
    if (e instanceof CutoverUnsetError) {
      reportFailure({ product: 'karute', kind: 'ledger.cutover_unset', business_id: row.business_id, ref: row.id })
      return keepPending(store, row, { leased_until: null, last_error_code: 'cutover_unset' })
    }
    // a pre-check / pre-read that errors = pending, never a silent shape change (R2)
    return keepPending(store, row, { leased_until: null, last_error_code: 'precheck_error', last_error_text: e instanceof Error ? e.message : String(e) })
  }
}

async function refuse(store: LedgerStore, row: IntentRow, code: string, now: Date, extra: Partial<IntentRow> = {}): Promise<IntentRow> {
  const state: IntentState = row.withdraw_requested_at ? 'withdrawn' : 'refused'
  const done = await store.update(row.business_id, row.id, { state: 'pending' }, {
    ...extra, state, leased_until: null,
    ...(state === 'refused' ? { refused_at: iso(now), refused_code: code } : { withdrawn_at: iso(now), withdrawn_by: 'system' }),
  })
  if (state === 'refused' && code !== 'already_redeemed') {
    reportFailure({ product: 'karute', kind: 'ledger.refused', business_id: row.business_id, ref: row.id, facts: { code } })
  }
  return done ?? (await reread(store, row))
}

// ── R1 + R1-gate: record a use (P1 web, P2 facade, P6 recovery) ─────────────
export interface RecordUseInput {
  intentId?: string
  businessId: string
  ownerUserId: string | null
  staffId: string | null
  customerId: string
  packId: string
  /** undefined = derive the booking (R2); null = an explicit walk-in. */
  appointmentId?: string | null
  redeemedOn?: string
  gestureAt?: string | null
  source?: 'manual' | 'backfill'
  recovery?: boolean
  anotherSession?: boolean
  karuteRecordId?: string | null
}
export type UseState = 'settled' | 'pending' | 'held' | 'refused' | 'withdrawn'
export interface RecordUseResult {
  ok: boolean
  state?: UseState
  redemptionId?: string
  intentId?: string
  heldAgainst?: string
  error?: string
}

export function answerFromRow(row: IntentRow): RecordUseResult {
  const base = { intentId: row.id }
  switch (row.state) {
    case 'settled': return { ...base, ok: true, state: 'settled', redemptionId: row.settled_core_id ?? undefined }
    case 'pending':
    case 'parked': return { ...base, ok: true, state: 'pending' }
    case 'held': return { ...base, ok: true, state: 'held', heldAgainst: row.held_against ?? undefined }
    case 'withdrawn': return { ...base, ok: false, state: 'withdrawn' }
    case 'refused': {
      const code = row.refused_code
      const error = code === 'no_units' ? 'below_zero' : code === 'already_redeemed' ? 'already_redeemed' : (row.last_error_text ?? code ?? 'refused')
      return { ...base, ok: false, state: 'refused', error }
    }
  }
}

/** A held/pending/parked WALK-IN use for this customer on this JST day. A
 *  BOOKED intent never gates and is never held (⚖ 8/21); refused never gates. */
export function gatingIntent(rows: IntentRow[], customerId: string, redeemedOn: string, selfId: string): IntentRow | null {
  return rows.find((r) => r.id !== selfId && r.kind === 'use' && r.customer_id === customerId &&
    r.appointment_id === null && OPEN.includes(r.state) && day(r.redeemed_on) === redeemedOn) ?? null
}

export async function recordUse(deps: AttemptDeps, input: RecordUseInput): Promise<RecordUseResult> {
  const { store, synqed } = deps
  const now = (deps.now ?? (() => new Date()))()
  const id = input.intentId ?? globalThis.crypto.randomUUID()
  try {
    const existing = await store.getAllById(id)
    if (existing.some((r) => r.business_id !== input.businessId)) {
      return { ok: false, state: 'refused', error: 'foreign_key', intentId: id }
    }
    let row = existing[0]
    if (!row) {
      const g = acceptGestureAt(input.gestureAt, now)
      if (g.clockSuspect) {
        reportFailure({ product: 'karute', kind: 'ledger.clock_suspect', business_id: input.businessId, ref: id, facts: { gesture_at_client: g.gestureAtClient } })
      }
      const redeemedOn = input.redeemedOn ?? ymdInJst(new Date(g.gestureAt))
      const appt = input.appointmentId !== undefined
        ? input.appointmentId
        : await lookupAppointmentForDay(synqed, input.customerId, redeemedOn)
      const resolved = appt !== 'unknown'
      const appointmentId = resolved ? appt : null
      const source: LedgerSource = input.recovery ? 'recovery' : (input.source ?? 'manual')
      let state: IntentState = 'pending'
      let heldAgainst: string | null = null
      if (resolved && appointmentId === null && !input.anotherSession) {
        const earlier = gatingIntent(await store.listForCustomers(input.businessId, [input.customerId]), input.customerId, redeemedOn, id)
        if (earlier) { state = 'held'; heldAgainst = earlier.id }
      }
      const payload: CorePayload = {
        pack_id: input.packId, customer_id: input.customerId, redeemed_on: redeemedOn, appointment_id: appointmentId,
        karute_record_id: input.karuteRecordId ?? null, source: input.source ?? 'manual', created_by: input.staffId,
      }
      await store.insertIgnore({
        id, business_id: input.businessId, owner_user_id: input.ownerUserId, kind: 'use',
        ledger_source: source, core_source: input.source ?? 'manual', customer_id: input.customerId,
        pack_id: input.packId, pack_picked_by: 'staff', appointment_id: appointmentId, appointment_resolved: resolved,
        gesture_at: g.gestureAt, gesture_at_client: g.gestureAtClient, clock_suspect: g.clockSuspect,
        redeemed_on: redeemedOn, counts_as_visit: null, another_session: Boolean(input.anotherSession),
        // written once: now when the booking is known, else on the first successful lookup
        frozen_payload: resolved ? payload : null,
        audit_payload: {
          ...(g.gestureAtClient ? { gesture_at_client: g.gestureAtClient } : {}),
          ...(resolved ? {} : { draft_payload: payload }),
        },
        state, attempts: 0, held_at: state === 'held' ? iso(now) : null, held_against: heldAgainst,
      })
      const back = (await store.getAllById(id))
      if (back.some((r) => r.business_id !== input.businessId)) return { ok: false, state: 'refused', error: 'foreign_key', intentId: id }
      row = back[0]
      if (!row) throw new Error('ledger read-back empty')
    }
    // 「もう1回分を消化する」: held → pending, another_session set at that moment, sent at once
    if (row.state === 'held' && input.anotherSession) {
      row = (await store.update(row.business_id, row.id, { state: 'held' }, { state: 'pending', another_session: true })) ?? (await reread(store, row))
    }
    if (row.state !== 'pending') return answerFromRow(row)
    return answerFromRow(await attemptIntent(deps, row))
  } catch {
    // R1: no ledger row → no core call. The client wrapper holds the gesture (PR-B).
    return { ok: false, error: 'ledger_unavailable', intentId: id }
  }
}

// ── § 5 the settle pass ──────────────────────────────────────────────────────
export interface SettleSummary { businesses: number; attempted: number; settled: number; refused: number; stillOpen: number; parked: number; outOfBudget: boolean }

export async function settlePending(opts: {
  store: LedgerStore
  clientFor: (businessId: string) => Pick<SynqedClient, 'packs' | 'appointments'>
  rotate: (ids: readonly string[], now: Date) => string[]
  dailyPass: boolean
  now?: () => Date
  budgetMs?: number
  concurrency?: number
}): Promise<SettleSummary> {
  const clock = opts.now ?? (() => new Date())
  const startedAt = clock()
  const deadline = startedAt.getTime() + (opts.budgetMs ?? SETTLE_BUDGET_MS)
  const states: IntentState[] = opts.dailyPass ? ['pending', 'parked'] : ['pending']
  const s: SettleSummary = { businesses: 0, attempted: 0, settled: 0, refused: 0, stillOpen: 0, parked: 0, outOfBudget: false }
  const openByBusiness = new Map<string, { count: number; oldest: string }>()
  const ids = opts.rotate(await opts.store.listOpenBusinessIds([...OPEN]), startedAt)
  for (const businessId of ids) {
    if (clock().getTime() >= deadline) { s.outOfBudget = true; break }
    s.businesses += 1
    const synqed = opts.clientFor(businessId)
    const rows = await opts.store.listOpen(businessId, states, SETTLE_ROWS_PER_BUSINESS)
    let next = 0
    const worker = async () => {
      while (next < rows.length && clock().getTime() < deadline) {
        let row = rows[next++]
        if (row.state === 'parked') {
          row = (await opts.store.update(businessId, row.id, { state: 'parked' }, { state: 'pending', resumed_at: iso(clock()) })) ?? row
        }
        s.attempted += 1
        const out = await attemptIntent({ store: opts.store, synqed, now: clock }, row)
        if (out.state === 'settled') s.settled += 1
        else if (out.state === 'refused') s.refused += 1
        else if (out.state === 'pending' && opts.dailyPass && out.created_at &&
          clock().getTime() - Date.parse(out.created_at) >= PARK_AFTER_MS) {
          const p = await opts.store.update(businessId, out.id, { state: 'pending' }, { state: 'parked', parked_at: iso(clock()), parked_reason: out.last_error_code ?? 'unsettled' })
          if (p) { s.parked += 1; reportFailure({ product: 'karute', kind: 'ledger.parked', business_id: businessId, ref: out.id, facts: { code: out.last_error_code } }) }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? SETTLE_CONCURRENCY) }, worker))
    const left = (await opts.store.listOpen(businessId, [...OPEN], SETTLE_ROWS_PER_BUSINESS))
    if (left.length) openByBusiness.set(businessId, { count: left.length, oldest: left[0].created_at ?? '' })
  }
  // § 7 (a) rolled up per pass across businesses
  s.stillOpen = [...openByBusiness.values()].reduce((a, b) => a + b.count, 0)
  if (s.stillOpen > 0) {
    const top = [...openByBusiness.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, ALARM_TOP_N)
    reportFailure({ product: 'karute', kind: 'ledger.open_at_pass', business_id: null, facts: {
      count: s.stillOpen, worst: [...openByBusiness.values()].map((v) => v.oldest).sort()[0], top: top.map(([b, v]) => ({ b, n: v.count })),
    } })
  }
  return s
}

// ── § 6b the ledger-aware usage numbers ─────────────────────────────────────
export interface CustomerLedgerUsage {
  /** pending+parked uses per pack_id */
  pendingByPack: Map<string, number>
  heldByPack: Map<string, number>
  /** pending undos per pack_id (they ADD BACK, chip 取消待ち) */
  pendingUndoByPack: Map<string, number>
  /** open uses with no pack yet (P3 before the pick) */
  noPackPending: number
  /** open uses (held+pending+parked) per JST day — the double-guard number */
  usesByDay: Map<string, number>
  /** refused-unresolved rows: SHOWN, never block */
  refused: IntentRow[]
}

export type LedgerUsageRead = { ok: true; byCustomer: Map<string, CustomerLedgerUsage> } | { ok: false }

function emptyUsage(): CustomerLedgerUsage {
  return { pendingByPack: new Map(), heldByPack: new Map(), pendingUndoByPack: new Map(), noPackPending: 0, usesByDay: new Map(), refused: [] }
}
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

export function usageFromRows(rows: IntentRow[]): Map<string, CustomerLedgerUsage> {
  const out = new Map<string, CustomerLedgerUsage>()
  for (const r of rows) {
    const u = out.get(r.customer_id) ?? emptyUsage()
    out.set(r.customer_id, u)
    if (r.state === 'refused') { if (!r.staff_resolution) u.refused.push(r); continue }
    if (!OPEN.includes(r.state)) continue
    if (r.kind === 'undo') { if (r.pack_id && r.state !== 'held') bump(u.pendingUndoByPack, r.pack_id); continue }
    bump(u.usesByDay, day(r.redeemed_on))
    if (!r.pack_id) { u.noPackPending += 1; continue }
    bump(r.state === 'held' ? u.heldByPack : u.pendingByPack, r.pack_id)
  }
  return out
}

export async function readLedgerUsage(store: LedgerStore, businessId: string, customerIds: string[]): Promise<LedgerUsageRead> {
  try {
    return { ok: true, byCustomer: usageFromRows(await store.listForCustomers(businessId, customerIds)) }
  } catch {
    return { ok: false }
  }
}

/** § 6a: server − pending − held + pending undos, per pack_id. */
export function displayRemaining(serverRemaining: number, u: CustomerLedgerUsage | undefined, packId: string): number {
  if (!u) return serverRemaining
  return Math.max(0, serverRemaining - (u.pendingByPack.get(packId) ?? 0) - (u.heldByPack.get(packId) ?? 0) + (u.pendingUndoByPack.get(packId) ?? 0))
}
