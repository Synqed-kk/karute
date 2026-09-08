// Recording-integrity PR A1 — the disclosed-discard RECEIPT (spec §3.6, §10),
// reworked to the ⚖ 8/17 written-reason shapes at P5-A.
//
// The receipt IS the product here, so these tests assert the properties a
// trace-grade audit row never has to carry: exactly ONE row per discard across
// BOTH doors, a DURABLE row before any success is reported, silent-success
// idempotency, and a detail payload that is ids/flags/counts and nothing else.
//
// P5-A replaced the category enum with two discriminated shapes. The fixtures
// below follow it: STAFF carries the id of the core discard row holding the
// written reason, SYSTEM carries the old `abandoned` semantics and nothing
// else. §8 adds the STAFF door itself — reason row first, receipt second,
// both idempotent, and a failed row-create never reported as a discard.
//
// The facade assertions run through the real facadeHandler, so the generic
// on-2xx hook's NON-emission is proven rather than assumed (a live
// FACADE_AUDIT_MAP row would silently double every receipt).
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))

process.env.SYNQED_CORE_URL ??= 'https://core.test'
process.env.SYNQED_CORE_API_KEY ??= 'test-core-key'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

// ── A tiny in-memory core audit_log ────────────────────────────────────────
// list() reads back what log() wrote, so idempotency is exercised against
// real round-trip behaviour instead of a hand-stubbed "second call" answer.
interface CoreRow {
  id: string
  category: string
  action: string
  target_type: string | null
  target_id: string | null
  detail: unknown
  severity: string
  actor_id: string | null
  actor_type: string
  store_id: string | null
}
const coreRows: CoreRow[] = []
const logFails = { next: false }

// Return type is deliberately widened to allow undefined: core always hands
// back the created row, but forwardToCore guards for a partial mock that
// doesn't — and the rowId-fallback test exercises exactly that.
const auditLog = jest.fn(async (input: Record<string, unknown>): Promise<CoreRow | undefined> => {
  if (logFails.next) {
    logFails.next = false
    throw new Error('core unavailable')
  }
  const row = { id: `row-${coreRows.length + 1}`, ...input } as unknown as CoreRow
  coreRows.push(row)
  return row
})
const auditList = jest.fn(async (q: Record<string, unknown>) => {
  const events = coreRows.filter(
    (r) =>
      (!q.category || r.category === q.category) &&
      (!q.target_type || r.target_type === q.target_type) &&
      (!q.target_id || r.target_id === q.target_id),
  )
  return { events, total: events.length, page: 1, page_size: 50 }
})

/** Mirrors the real SDK: AuditClient.log/list are PROTOTYPE methods that read
 *  `this` — a receiver-losing call (`const { list } = synqed.audit`) rejects
 *  here exactly like prod. A plain `{ log, list }` object literal cannot catch
 *  that bug class, and it is the precise bug discard.ts's own comment cites as
 *  having silently killed every probe in production once already. Same pattern
 *  as app-api-audit-log.test.ts's wrapper. */
class ThisSensitiveAuditClient {
  constructor(
    private logImpl: jest.Mock,
    private listImpl: jest.Mock,
  ) {}
  async log(input: unknown) {
    return this.logImpl(input)
  }
  async list(q: unknown) {
    return this.listImpl(q)
  }
}
// ── A tiny in-memory core recording_discards ledger (P5-A) ─────────────────
// Same round-trip discipline as the audit fake above: list() reads back what
// create() wrote, so the probe-first idempotency is exercised for real.
interface DiscardRow {
  id: string
  recording_session_id: string
  source: 'STAFF' | 'SYSTEM'
  discarded_by: string | null
  reason: string | null
  created_at: string
}
const discardLedger: DiscardRow[] = []
const createFails = { next: false }
const discardCreate = jest.fn(async (input: Record<string, unknown>): Promise<DiscardRow> => {
  if (createFails.next) {
    createFails.next = false
    throw new Error('core unavailable')
  }
  const row = {
    id: `dr-${discardLedger.length + 1}`,
    created_at: '2026-08-25T00:00:00.000Z',
    ...input,
  } as unknown as DiscardRow
  discardLedger.push(row)
  return row
})
const discardList = jest.fn(async (q: Record<string, unknown> = {}) => {
  const events = discardLedger.filter(
    (r) =>
      (!q.recording_session_id || r.recording_session_id === q.recording_session_id) &&
      (!q.source || r.source === q.source),
  )
  return { events, total: events.length, page: 1, page_size: 50 }
})
class ThisSensitiveDiscardClient {
  constructor(
    private createImpl: jest.Mock,
    private listImpl: jest.Mock,
  ) {}
  async create(input: unknown) {
    return this.createImpl(input)
  }
  async list(q?: unknown) {
    return this.listImpl(q)
  }
}

/** The below-floor stamp (names-fix 2026-08-31): the ONE recordings write this
 *  path makes. Kept a bare jest.fn — its ARGUMENTS are the whole claim. */
const recordingUpdate = jest.fn(async (id: string, input: Record<string, unknown>) => ({
  id,
  ...input,
}))

const fakeClient = {
  audit: new ThisSensitiveAuditClient(auditLog, auditList),
  recordingDiscards: new ThisSensitiveDiscardClient(discardCreate, discardList),
  recordings: { update: recordingUpdate },
}

// forwardToCore's own dynamically-imported client (the durable WRITE).
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn().mockImplementation(() => ({
    audit: new ThisSensitiveAuditClient(auditLog, auditList),
  })),
  SynqedError: class extends Error {},
}))

// The caller-constructed, business-scoped client (the idempotency PROBE).
// Wrapped in a jest.fn so the businessId the chokepoint scopes to is itself
// assertable (a receipt written against the wrong tenant's client would be a
// silent cross-tenant leak).
const newSynqedClientSpy = jest.fn((businessId: string) => {
  void businessId // the fake client is business-agnostic; the ARG is what we assert on
  return fakeClient
})
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClientSpy(businessId),
  getSynqedClient: async () => fakeClient,
}))

const capabilities = { current: new Set<string>(['customers.view', 'records.write']) }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
  getCurrentUserStaffId: jest.fn(async () => 'auth-user-1'),
  getCurrentAccessToken: jest.fn(async () => 'web-cookie-token'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'auth-user-1', full_name: '田中', display_role: 'practitioner' }]),
}))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return {
    ...actual,
    capabilitiesForUser: jest.fn(async () => capabilities.current),
    getMyCapabilities: jest.fn(async () => capabilities.current),
    requireCapability: jest.fn(async (cap: string) => actual.ensureCapability(capabilities.current, cap)),
  }
})

const getUser = {
  fn: jest.fn(async () => ({ data: { user: { id: 'auth-user-1' } }, error: null as { message: string } | null })),
}
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: (...a: unknown[]) => getUser.fn(...(a as [])) } }),
}))

import { discardRecordingReceipt, discardRecordingWithReason } from '@/actions/recording-discard'
import { discardRecordingWithClient, discardRecordingWithReasonRow } from '@/lib/recording/discard'
import { POST as discardPOST } from '@/app/api/app/v1/recordings/discard/route'
import { FACADE_AUDIT_MAP } from '@/lib/audit'
import { BELOW_FLOOR_SEC } from '@/lib/recording/discard-floor'

// ── Bearer plumbing (same shape as app-api-recording-consent.test.ts) ───────
const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer(sub = 'auth-user-1') {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub, iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}`, 'content-type': 'application/json' }
const noRoute = { params: Promise.resolve({}) }
const post = (body: unknown, headers: Record<string, string> = auth) =>
  discardPOST(
    new Request('https://s/api/app/v1/recordings/discard', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    noRoute,
  )

/** A STAFF receipt: no category, and the id of the core discard row that holds
 *  the written reason. The reason TEXT is never in this payload — the receipt
 *  schema has no field for it (§5 pins that). */
const VALID = {
  recordingSessionId: 'rs-1',
  source: 'STAFF' as const,
  discardRowId: 'dr-1',
  durationSeconds: 12.4,
  customerId: 'cust-1',
  appointmentId: 'appt-1',
  pipeline: 'in_tab' as const,
  jobState: null,
}

/** A SYSTEM receipt — the old `abandoned` semantics, unchanged. */
const SYSTEM_VALID = {
  recordingSessionId: 'rs-1',
  source: 'SYSTEM' as const,
  durationSeconds: 12.4,
  customerId: 'cust-1',
  appointmentId: 'appt-1',
  pipeline: 'in_tab' as const,
  jobState: null,
}

/** The STAFF door's input (§8): the same take fields, plus the reason. */
const WITH_REASON = {
  recordingSessionId: 'rs-1',
  reason: 'お客様が席を外したため録り直します',
  durationSeconds: 12.4,
  customerId: 'cust-1',
  appointmentId: 'appt-1',
  pipeline: 'in_tab' as const,
  jobState: null,
}

/**
 * File a STAFF receipt the ONLY way anything can now (fix round 1, FIX-4).
 *
 * `VALID` above is a STAFF receipt SHAPE, and it used to be posted straight at
 * the receipt-only door. That door no longer accepts one: `discardRowId` is the
 * entire basis of a STAFF receipt's honesty, so the STAFF arm is reachable only
 * behind a module-internal vouch that `discardRecordingWithReasonRow` passes
 * after it has actually written the row (§9 pins the refusal from outside).
 *
 * The receipt this produces is byte-identical to the one `VALID` used to
 * produce — same take fields, `discard_row_id: 'dr-1'` from the ledger fake —
 * so every assertion below is UNCHANGED. Only the door moved, and it moved onto
 * the path production actually uses, which means these cases now exercise
 * `discardRecordingWithClient`'s dedupe/scoping/detail derivation through the
 * real caller rather than a shape nothing can send any more.
 */
const staffReceipt = (over: Record<string, unknown> = {}) =>
  discardRecordingWithReason({ ...WITH_REASON, ...over })

/** Seed a non-discard row on a target — the probe must ignore it. */
function seedRow(over: Partial<CoreRow> & { action: string; target_id: string | null }) {
  coreRows.push({
    id: `seed-${coreRows.length + 1}`,
    category: 'recording',
    target_type: 'recording',
    detail: null,
    severity: 'info',
    actor_id: 'auth-user-1',
    actor_type: 'staff',
    store_id: null,
    ...over,
  } as CoreRow)
}

const webActor = { staffId: 'auth-user-1', businessId: 'business-1', source: 'web' as const, requestId: 'req-web-1' }

const discardRows = () => coreRows.filter((r) => r.action === 'recording.discard')

beforeEach(() => {
  jest.clearAllMocks()
  coreRows.length = 0
  discardLedger.length = 0
  logFails.next = false
  createFails.next = false
  capabilities.current = new Set(['customers.view', 'records.write'])
})

// ── 1. Both doors, exactly one row each (T6/T9 slice) ──────────────────────

describe('one discard = exactly one recording.discard row', () => {
  it('the WEB action writes one durable row carrying the §10.3 detail', async () => {
    const res = await staffReceipt()

    expect(res).toEqual({ ok: true, receiptId: 'row-1', duplicate: false })
    expect(discardRows()).toHaveLength(1)
    expect(auditLog).toHaveBeenCalledTimes(1)
    expect(auditLog.mock.calls[0][0]).toMatchObject({
      category: 'recording',
      action: 'recording.discard',
      actor_type: 'staff',
      actor_id: 'auth-user-1',
      target_type: 'recording',
      target_id: 'rs-1',
      severity: 'warn', // app 'notice' → core 'warn'
      detail: {
        recording_session_id: 'rs-1',
        take_id: null,
        staff_id: 'auth-user-1',
        customer_id: 'cust-1',
        appointment_id: 'appt-1',
        category: null, // ⚖ 8/17: the enum is dead for staff discards
        duration_sec: 12,
        below_floor: false, // 12.4s is at or above the §3.5 floor
        route: 'operational',
        pipeline: 'in_tab',
        job_state: null,
        has_free_text: true, // a staff discard always states a reason
        discard_row_id: 'dr-1', // …and always points at the row holding it
        system_emitted: false,
      },
    })
  })

  it('the FACADE route writes one row — the on-2xx hook does NOT add a second', async () => {
    const res = await post(WITH_REASON)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ receiptId: 'row-1', duplicate: false })
    // THE one-event law: through the real facadeHandler, still one row.
    expect(discardRows()).toHaveLength(1)
    expect(coreRows).toHaveLength(1)
  })

  it("FACADE_AUDIT_MAP['recordings.discard'] is a skip row — the map itself cannot re-emit", () => {
    expect(FACADE_AUDIT_MAP['recordings.discard']).toMatchObject({ kind: 'skip', action: '' })
  })

  it("the 'use server' module exposes ONLY the cookie-resolved wrapper", async () => {
    // Every exported async fn in a 'use server' file is a client-invokable
    // action. discardRecordingWithClient takes a caller-vouched `actor`, so it
    // must live in the directive-free lib module — exported from here it would
    // let a caller write receipts attributed to anyone in the business.
    const actionsModule = await import('@/actions/recording-discard')
    expect(Object.keys(actionsModule).sort()).toEqual(
      ['discardRecordingReceipt', 'discardRecordingWithReason'].sort(),
    )

    const source = readFileSync(join(process.cwd(), 'src/lib/recording/discard.ts'), 'utf8')
    expect(source).not.toMatch(/^\s*['"]use server['"]/m)
  })

  it('the facade row carries the SERVER-minted requestId, not a client-supplied one', async () => {
    const res = await post(WITH_REASON, { ...auth, 'request-id': 'forged-by-client' })
    const detail = auditLog.mock.calls[0][0].detail as Record<string, unknown>
    // Pinned to the ACTUAL ctx.meta.requestId, which the handler echoes on the
    // response — "not the forged one" alone would pass on any random value.
    const minted = res.headers.get('request-id')
    expect(minted).toBeTruthy()
    expect(detail.request_id).toBe(minted)
    expect(detail.request_id).not.toBe('forged-by-client')
  })

  it('scopes the core client to the CALLER’s business, never a body-supplied one', async () => {
    await post({ ...WITH_REASON, businessId: 'someone-elses-business' })
    // (the extra key also proves .strict() rejects it — hence no row)
    expect(discardRows()).toHaveLength(0)

    await post(WITH_REASON)
    expect(newSynqedClientSpy).toHaveBeenCalledWith('business-1')
    expect(auditLog.mock.calls[0][0]).toMatchObject({ actor_id: 'auth-user-1' })
  })

  it('falls back to the minted requestId when core returns no row id', async () => {
    auditLog.mockImplementationOnce(async () => undefined)
    const res = await discardRecordingWithReasonRow(fakeClient as never, webActor, WITH_REASON)

    expect(res).toEqual({ ok: true, receiptId: 'req-web-1', duplicate: false })
  })

  it('the facade route rejects a malformed JSON body with 400', async () => {
    const res = await discardPOST(
      new Request('https://s/api/app/v1/recordings/discard', {
        method: 'POST',
        headers: auth,
        body: '{not json',
      }),
      noRoute,
    )

    expect(res.status).toBe(400)
    expect(discardRows()).toHaveLength(0)
  })
})

// ── 2. Idempotency (spec §3.6 — silent success, never an error) ────────────

describe('idempotency on the take key', () => {
  it('a second discard of the same recordingSessionId writes NOTHING and reports duplicate', async () => {
    const first = await staffReceipt()
    expect(first).toMatchObject({ ok: true, duplicate: false })

    const second = await staffReceipt()

    expect(second).toEqual({ ok: true, receiptId: 'row-1', duplicate: true })
    expect(discardRows()).toHaveLength(1) // zero new writes
  })

  // Pre-mint takes live on the SYSTEM arm now: a STAFF receipt needs its
  // discard row, and that row keys on the session id (G14).
  it('holds for the takeId-only (pre-mint) case too', async () => {
    const preMint = { ...SYSTEM_VALID, recordingSessionId: null, takeId: 'take-9' }
    await discardRecordingWithClient(fakeClient as never, webActor, preMint)
    const second = await discardRecordingWithClient(fakeClient as never, webActor, preMint)

    expect(second).toMatchObject({ ok: true, duplicate: true })
    expect(discardRows()).toHaveLength(1)
    expect(discardRows()[0].target_id).toBe('take-9')
    expect((discardRows()[0].detail as Record<string, unknown>).take_id).toBe('take-9')
  })

  it('crosses the two doors — a web discard then the facade one is still one row', async () => {
    await staffReceipt()
    const res = await post(WITH_REASON)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ receiptId: 'row-1', duplicate: true })
    expect(discardRows()).toHaveLength(1)
  })

  it('a DIFFERENT take is not deduped against an existing receipt', async () => {
    await staffReceipt()
    const other = await staffReceipt({ recordingSessionId: 'rs-2' })

    expect(other).toMatchObject({ ok: true, duplicate: false })
    expect(discardRows()).toHaveLength(2)
  })

  // THE worst failure mode: a false-positive duplicate silently swallows a real
  // discard — the receipt is lost and the caller is told everything is fine.
  it('non-discard rows on the SAME target never read as a prior receipt', async () => {
    seedRow({ action: 'recording.transcribe', target_id: 'rs-1' })
    seedRow({ action: 'recording.transcribe', target_id: 'rs-1' })
    seedRow({ action: 'karute.save', target_id: 'rs-1', target_type: 'karute' })
    // …plus a real discard, but on somebody else's take.
    seedRow({ action: 'recording.discard', target_id: 'rs-999' })

    const res = await staffReceipt()

    expect(res).toMatchObject({ ok: true, duplicate: false })
    expect(discardRows().filter((r) => r.target_id === 'rs-1')).toHaveLength(1)
  })

  it('a pre-mint receipt filed under takeId dedupes the post-mint retry carrying BOTH ids', async () => {
    // Offline discard before the session was minted → receipt keyed on take_id.
    const preMint = { ...SYSTEM_VALID, recordingSessionId: null, takeId: 'take-7' }
    const first = await discardRecordingReceipt(preMint)
    expect(first).toMatchObject({ ok: true, duplicate: false })

    // The retry now knows its session id too. Probing only the session id would
    // miss the existing receipt and write a second row for the same take.
    const retry = await discardRecordingReceipt({ ...SYSTEM_VALID, recordingSessionId: 'rs-1', takeId: 'take-7' })

    expect(retry).toMatchObject({ ok: true, duplicate: true })
    expect(discardRows()).toHaveLength(1)
    expect(auditList.mock.calls.map((c) => c[0].target_id)).toContain('take-7')
  })
})

// ── 3. The §3.6 ordering guarantee, server half ────────────────────────────

describe('a dropped durable write is never reported as success', () => {
  it('the web action returns a failure result', async () => {
    logFails.next = true
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await staffReceipt()
    warn.mockRestore()

    expect(res).toEqual({ ok: false, error: 'receipt_write_failed' })
    expect(discardRows()).toHaveLength(0)
  })

  it('the facade route returns a NON-2xx', async () => {
    logFails.next = true
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post(WITH_REASON)
    warn.mockRestore()

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).not.toBe(200)
    expect(discardRows()).toHaveLength(0)
  })
})

// ── 4. system_emitted is SERVER-derived (spec §3.2) ────────────────────────

describe('system_emitted derivation', () => {
  it("source 'SYSTEM' keeps the abandoned semantics: system_emitted true, no reason, no row", async () => {
    const res = await discardRecordingReceipt(SYSTEM_VALID)
    const detail = discardRows()[0].detail as Record<string, unknown>

    expect(res).toMatchObject({ ok: true })
    expect(detail.system_emitted).toBe(true)
    expect(detail.category).toBe('abandoned') // the label survives, server-derived
    expect(detail.has_free_text).toBe(false)
    expect(detail.discard_row_id).toBeNull()
    // The actor stays the take's OWNER, not 'system' (spec §3.7).
    expect(discardRows()[0].actor_type).toBe('staff')
    expect(discardRows()[0].actor_id).toBe('auth-user-1')
  })

  it("source 'STAFF' derives system_emitted: false", async () => {
    await staffReceipt()
    expect((discardRows()[0].detail as Record<string, unknown>).system_emitted).toBe(false)
  })

  it('a client-supplied system_emitted is REFUSED, never honoured', async () => {
    const res = await discardRecordingReceipt({ ...VALID, system_emitted: true })

    expect(res).toEqual({ ok: false, error: 'validation' })
    expect(discardRows()).toHaveLength(0)
  })

  it('a client-supplied category is REFUSED — the enum is dead as an input (⚖ 8/17)', async () => {
    for (const category of ['mistap', 'quality', 'duplicate', 'wrong_target', 'not_session', 'abandoned']) {
      expect(await discardRecordingReceipt({ ...VALID, category })).toEqual({
        ok: false,
        error: 'validation',
      })
    }
    expect(discardRows()).toHaveLength(0)
  })
})

// ── 5. Validation (the receipt schema still has NO free-text field) ────────

describe('input validation', () => {
  it('refuses an unknown source', async () => {
    expect(await discardRecordingReceipt({ ...VALID, source: 'because_i_felt_like_it' })).toEqual({
      ok: false,
      error: 'validation',
    })
    expect(discardRows()).toHaveLength(0)
  })

  // THE doc law (⚖ 8/17 / G5): the written reason is CONTENT. It belongs in
  // the core discard row and may never ride into an audit detail, so the
  // receipt schema must have nowhere to put it — including on the STAFF arm
  // that now exists precisely because a reason was written.
  it.each(['reason', 'note', 'comment', 'freeText'])('refuses a free-text-shaped field (%s)', async (field) => {
    expect(await discardRecordingReceipt({ ...VALID, [field]: 'the customer asked me to delete it' })).toEqual({
      ok: false,
      error: 'validation',
    })
    expect(await discardRecordingReceipt({ ...SYSTEM_VALID, [field]: 'anything' })).toEqual({
      ok: false,
      error: 'validation',
    })
    expect(discardRows()).toHaveLength(0)
  })

  it('refuses a STAFF receipt with no discard row behind it', async () => {
    const noRow: Record<string, unknown> = { ...VALID }
    delete noRow.discardRowId
    expect(await discardRecordingReceipt(noRow)).toEqual({ ok: false, error: 'validation' })
    expect(await discardRecordingReceipt({ ...VALID, discardRowId: '' })).toEqual({
      ok: false,
      error: 'validation',
    })
    expect(discardRows()).toHaveLength(0)
  })

  it('refuses a STAFF receipt with no session id (the row keys on it)', async () => {
    const noSession: Record<string, unknown> = { ...VALID, takeId: 'take-1' }
    delete noSession.recordingSessionId
    expect(await discardRecordingReceipt(noSession)).toEqual({ ok: false, error: 'validation' })
    expect(discardRows()).toHaveLength(0)
  })

  it('refuses a SYSTEM receipt carrying a discard row id (system rows have none)', async () => {
    expect(await discardRecordingReceipt({ ...SYSTEM_VALID, discardRowId: 'dr-1' })).toEqual({
      ok: false,
      error: 'validation',
    })
    expect(discardRows()).toHaveLength(0)
  })

  it('refuses a receipt with no take key at all', async () => {
    const noKey: Record<string, unknown> = { ...SYSTEM_VALID }
    delete noKey.recordingSessionId
    expect(await discardRecordingReceipt(noKey)).toEqual({ ok: false, error: 'validation' })
    // …and an explicitly-nulled pair is just as keyless.
    expect(await discardRecordingReceipt({ ...SYSTEM_VALID, recordingSessionId: null, takeId: null })).toEqual({
      ok: false,
      error: 'validation',
    })
  })

  it('refuses a negative / non-finite duration', async () => {
    expect(await discardRecordingReceipt({ ...VALID, durationSeconds: -1 })).toMatchObject({ ok: false })
    expect(await discardRecordingReceipt({ ...VALID, durationSeconds: Number.POSITIVE_INFINITY })).toMatchObject({
      ok: false,
    })
    expect(discardRows()).toHaveLength(0)
  })

  it('the facade route maps a validation failure to 400 and writes nothing', async () => {
    const res = await post({ ...VALID, source: 'nope' })
    expect(res.status).toBe(400)
    expect(discardRows()).toHaveLength(0)
  })

  it('a caller without records.write cannot file a receipt (web + facade)', async () => {
    capabilities.current = new Set(['customers.view'])

    expect(await discardRecordingReceipt(VALID)).toEqual({ ok: false, error: 'forbidden' })
    expect((await post(VALID)).status).toBe(403)
    expect(discardRows()).toHaveLength(0)
  })
})

// ── 6. The ids-only detail contract (T9 pattern) ───────────────────────────

describe('detail carries ids/flags/counts only — never record content', () => {
  it('every emitted detail value is a string, number, boolean or null', async () => {
    await staffReceipt({ takeId: 'take-1', jobState: 'QUEUED' })
    const detail = discardRows()[0].detail as Record<string, unknown>

    for (const [key, value] of Object.entries(detail)) {
      expect(['string', 'number', 'boolean']).toContain(value === null ? 'string' : typeof value)
      expect(key).toBe(key.toLowerCase()) // snake_case keys, the detail-key convention
    }
  })

  it('the detail key set is exactly spec §10.3 (plus the request_id correlation key)', async () => {
    await staffReceipt()
    const detail = discardRows()[0].detail as Record<string, unknown>

    expect(Object.keys(detail).sort()).toEqual(
      [
        'appointment_id',
        'below_floor',
        'category',
        'customer_id',
        'discard_row_id',
        'duration_sec',
        'has_free_text',
        'job_state',
        'pipeline',
        'recording_session_id',
        'request_id',
        'route',
        'staff_id',
        'system_emitted',
        'take_id',
      ].sort(),
    )
  })

  it('the key set is IDENTICAL on both arms — a SYSTEM row hides nothing', async () => {
    await staffReceipt()
    const staffKeys = Object.keys(discardRows()[0].detail as object).sort()
    coreRows.length = 0
    await discardRecordingReceipt(SYSTEM_VALID)
    expect(Object.keys(discardRows()[0].detail as object).sort()).toEqual(staffKeys)
  })

  it('duration is a whole-second COUNT, never a raw float', async () => {
    await staffReceipt({ durationSeconds: 12.987 })
    expect((discardRows()[0].detail as Record<string, unknown>).duration_sec).toBe(13)
  })

  it('has_free_text follows the SOURCE, never a body value', async () => {
    await staffReceipt()
    expect((discardRows()[0].detail as Record<string, unknown>).has_free_text).toBe(true)
    coreRows.length = 0
    await discardRecordingReceipt(SYSTEM_VALID)
    expect((discardRows()[0].detail as Record<string, unknown>).has_free_text).toBe(false)
    // …and it cannot be asked for.
    coreRows.length = 0
    expect(await discardRecordingReceipt({ ...SYSTEM_VALID, has_free_text: true })).toEqual({
      ok: false,
      error: 'validation',
    })
  })
})

// ── below_floor is DERIVED, never claimed (spec §3.5, 10 seconds) ──────────

describe('below_floor derivation', () => {
  it.each([
    [0, true],
    [9.4, true],
    [9.99, true],
    [10, false],
    [12.4, false],
    [600, false],
  ])('%ss of audio → below_floor %s', async (durationSeconds, expected) => {
    await staffReceipt({ durationSeconds })
    expect((discardRows()[0].detail as Record<string, unknown>).below_floor).toBe(expected)
  })

  it('a client-supplied belowFloor is REFUSED — the flag can never contradict the duration', async () => {
    // The whole point: a 12.4s take cannot be filed as sub-floor by asking.
    expect(await discardRecordingReceipt({ ...VALID, belowFloor: true })).toEqual({
      ok: false,
      error: 'validation',
    })
    expect(discardRows()).toHaveLength(0)
  })
})

// ── the below-floor stamp (names-fix 2026-08-31) ───────────────────────────
// The receipt's below_floor flag above is written into an AUDIT row, which the
// manager panel never reads. The panel asks core for the recording and branches
// on `duration_seconds` — a column nothing in this repo had ever written, so it
// was null for every discard and a sub-floor take (never transcribed, by the ⚖
// spend gate) printed the same sentence as one whose words were simply not
// kept. These pin the write that makes the two distinguishable.

describe('the take’s duration is stamped on the recording', () => {
  it.each([
    [9.7, 9],
    [9.99, 9],
    // The floor ITSELF (fix round 1, FIX-6). Exactly 10.0 is the one value the
    // whole distinction turns on: it must stamp 10 and therefore read as a
    // NORMAL absence, not the below-floor sentence.
    [10, 10],
    [0.4, 0],
    [12.4, 12],
    [600, 600],
  ])('%ss of audio is stamped as %s — FLOORED, never rounded', async (durationSeconds, stored) => {
    // Rounding would store 10 for a 9.7s take and put it on the wrong side of
    // the panel's `< BELOW_FLOOR_SEC` predicate — a claim that words exist for
    // a take that was never sent to transcription at all.
    await staffReceipt({ durationSeconds })

    expect(recordingUpdate).toHaveBeenCalledTimes(1)
    expect(recordingUpdate).toHaveBeenCalledWith('rs-1', { duration_seconds: stored })
  })

  it('the FACADE door stamps it too — one behaviour, both doors', async () => {
    const res = await post(WITH_REASON)

    expect(res.status).toBe(200)
    expect(recordingUpdate).toHaveBeenCalledWith('rs-1', { duration_seconds: 12 })
  })

  it('the receipt-only door stamps it as well — a SYSTEM discard is still a take', async () => {
    await discardRecordingWithClient(fakeClient as never, webActor, SYSTEM_VALID)

    expect(recordingUpdate).toHaveBeenCalledWith('rs-1', { duration_seconds: 12 })
  })

  it('a stamp that FAILS never fails the discard — the take is already gone', async () => {
    recordingUpdate.mockRejectedValueOnce(new Error('core unreachable'))

    expect(await staffReceipt()).toMatchObject({ ok: true, duplicate: false })
    expect(recordingUpdate).toHaveBeenCalledTimes(1)
    // The receipt — the actual deliverable — landed regardless.
    expect(discardRows()).toHaveLength(1)
  })

  it('a pre-mint take has no session to stamp, and nothing is written', async () => {
    await discardRecordingWithClient(fakeClient as never, webActor, {
      ...SYSTEM_VALID,
      recordingSessionId: null,
      takeId: 'take-9',
    })

    expect(recordingUpdate).not.toHaveBeenCalled()
    expect(discardRows()).toHaveLength(1)
  })

  it('a duplicate discard does not re-stamp — the first one already did', async () => {
    await staffReceipt()
    await staffReceipt()

    expect(recordingUpdate).toHaveBeenCalledTimes(1)
  })

  it('a FAILED receipt stamps nothing — no row is left claiming a duration no audit line backs', async () => {
    // Fix round 1, FIX-3. The stamp used to run BEFORE the receipt attempt, so
    // a dropped durable write left a session carrying a freshly written
    // duration with no recording.discard row for that request — the panel
    // would then narrate a discard the ledger never recorded. The stamp now
    // fires only after the awaited receipt has actually landed.
    logFails.next = true
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await staffReceipt()
    warn.mockRestore()

    expect(res).toEqual({ ok: false, error: 'receipt_write_failed' })
    expect(recordingUpdate).not.toHaveBeenCalled()
  })

  // The floor is an INTEGER, and the equivalence the whole below-floor half
  // rests on holds only because it is: `Math.floor(x) < N` ⟺ `x < N` for
  // integer N. The stamp writes `Math.floor(duration)` into an Int column and
  // the panel asks `duration_seconds < BELOW_FLOOR_SEC` — a fractional floor
  // (7.5) would silently split the two apart, calling a 7.8s take below-floor
  // at the panel while the stamped 7 says the same thing for a different
  // reason, and a 7.2s take the other way round. Pinned so the constant cannot
  // move to a fraction without this failing first.
  it('BELOW_FLOOR_SEC is an integer — the stamp’s floor and the panel’s predicate agree', () => {
    expect(Number.isInteger(BELOW_FLOOR_SEC)).toBe(true)
  })
})

// ── jobState is a closed set (CO-2) ────────────────────────────────────────

describe('jobState', () => {
  it.each(['QUEUED', 'RUNNING', 'DONE', 'FAILED'])('accepts the real pipeline state %s', async (jobState) => {
    await staffReceipt({ jobState })
    expect((discardRows()[0].detail as Record<string, unknown>).job_state).toBe(jobState)
  })

  it('refuses an arbitrary string', async () => {
    expect(await discardRecordingReceipt({ ...VALID, jobState: 'whatever' })).toEqual({
      ok: false,
      error: 'validation',
    })
  })
})

// ── The chokepoint's own attribution guard (SF-6) ──────────────────────────

describe('an unattributable receipt is refused before any read or write', () => {
  it.each([
    ['no staffId', { staffId: null, businessId: 'business-1' }],
    ['no businessId', { staffId: 'auth-user-1', businessId: null }],
  ])('%s → forbidden, nothing probed, nothing written', async (_label, over) => {
    const res = await discardRecordingWithClient(fakeClient as never, { ...webActor, ...over }, VALID)

    expect(res).toEqual({ ok: false, error: 'forbidden' })
    expect(auditList).not.toHaveBeenCalled()
    expect(auditLog).not.toHaveBeenCalled()
  })
})

// ── 7. The probe must not become a silent no-op ────────────────────────────

describe('idempotency probe', () => {
  it('queries core through synqed.audit (receiver preserved) scoped to this take', async () => {
    await staffReceipt()
    expect(auditList).toHaveBeenCalledTimes(1)
    expect(auditList.mock.calls[0][0]).toMatchObject({
      category: 'recording',
      target_type: 'recording',
      target_id: 'rs-1',
    })
  })

  it('a FAILED probe still files the receipt (losing it would be worse than a duplicate)', async () => {
    auditList.mockRejectedValueOnce(new Error('core read down'))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await staffReceipt()
    warn.mockRestore()

    expect(res).toMatchObject({ ok: true, duplicate: false })
    expect(discardRows()).toHaveLength(1)
  })
})

// ── 8. The STAFF door — written reason first, receipt second (P5-A) ────────
// The reason row is the trace this whole lane exists to create; the receipt
// only points at it. So the order is load-bearing, both steps are idempotent,
// and NOTHING is reported as a discard unless both landed.

const staffActor = { ...webActor }
const quiet = async (fn: () => Promise<unknown>) => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    return await fn()
  } finally {
    warn.mockRestore()
  }
}

describe('the reason row lands first, and the receipt points at it', () => {
  it('writes the STAFF row with the written reason, then a receipt carrying its id', async () => {
    const res = await discardRecordingWithReason(WITH_REASON)

    expect(res).toMatchObject({ ok: true, duplicate: false })
    expect(discardCreate).toHaveBeenCalledTimes(1)
    expect(discardCreate.mock.calls[0][0]).toEqual({
      recording_session_id: 'rs-1',
      source: 'STAFF',
      discarded_by: 'auth-user-1',
      reason: WITH_REASON.reason,
    })
    expect((discardRows()[0].detail as Record<string, unknown>).discard_row_id).toBe('dr-1')
  })

  // The doc law, from the other side: whatever the staff member typed must not
  // be findable anywhere in the audit row.
  it('the reason TEXT never reaches the audit row', async () => {
    await discardRecordingWithReason(WITH_REASON)

    expect(JSON.stringify(discardRows()[0])).not.toContain(WITH_REASON.reason)
    expect(JSON.stringify(auditLog.mock.calls)).not.toContain(WITH_REASON.reason)
  })

  it('the row is written BEFORE the receipt', async () => {
    const order: string[] = []
    discardCreate.mockImplementationOnce(async () => {
      order.push('row')
      return {
        id: 'dr-1',
        recording_session_id: 'rs-1',
        source: 'STAFF' as const,
        discarded_by: 'auth-user-1',
        reason: WITH_REASON.reason,
        created_at: '2026-08-25T00:00:00.000Z',
      }
    })
    auditLog.mockImplementationOnce(async () => {
      order.push('receipt')
      return undefined
    })
    await discardRecordingWithReason(WITH_REASON)

    expect(order).toEqual(['row', 'receipt'])
  })

  it('a double tap writes ONE row and ONE receipt (probe-first)', async () => {
    const first = await discardRecordingWithReason(WITH_REASON)
    const second = await discardRecordingWithReason({ ...WITH_REASON, reason: '打ち直し' })

    expect(first).toMatchObject({ ok: true, duplicate: false })
    expect(second).toMatchObject({ ok: true, duplicate: true })
    expect(discardCreate).toHaveBeenCalledTimes(1) // the second tap reused the row
    expect(discardLedger).toHaveLength(1)
    expect(discardLedger[0].reason).toBe(WITH_REASON.reason) // …the FIRST reason stands
    expect(discardRows()).toHaveLength(1)
  })

  it('a SYSTEM row on the same session is never reused as a staff reason', async () => {
    discardLedger.push({
      id: 'dr-system',
      recording_session_id: 'rs-1',
      source: 'SYSTEM',
      discarded_by: null,
      reason: null,
      created_at: '2026-08-25T00:00:00.000Z',
    })

    await discardRecordingWithReason(WITH_REASON)

    expect(discardCreate).toHaveBeenCalledTimes(1)
    expect((discardRows()[0].detail as Record<string, unknown>).discard_row_id).not.toBe('dr-system')
  })

  it('a failed row-create is NEVER reported as a discard, and writes no receipt', async () => {
    createFails.next = true
    const res = await quiet(() => discardRecordingWithReason(WITH_REASON))

    expect(res).toEqual({ ok: false, error: 'discard_row_failed' })
    expect(discardRows()).toHaveLength(0)
    expect(auditLog).not.toHaveBeenCalled()
  })

  it('a retry after a failed receipt reuses the row instead of filing a second one', async () => {
    logFails.next = true
    const failed = await quiet(() => discardRecordingWithReason(WITH_REASON))
    expect(failed).toEqual({ ok: false, error: 'receipt_write_failed' })

    const retry = await discardRecordingWithReason(WITH_REASON)

    expect(retry).toMatchObject({ ok: true })
    expect(discardLedger).toHaveLength(1)
    expect(discardRows()).toHaveLength(1)
  })

  it('a blank reason never reaches core', async () => {
    for (const reason of ['', '   ']) {
      expect(await discardRecordingWithReason({ ...WITH_REASON, reason })).toEqual({
        ok: false,
        error: 'validation',
      })
    }
    // '   ' is non-empty for zod but blank for a human — the dialog's confirm
    // is gated on the trimmed value, so this is belt to that braces.
    expect(discardCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ reason: '' }),
    )
    expect(discardRows()).toHaveLength(0)

    // …and the padding around a REAL reason is stripped SERVER-side, not just
    // at the textarea: the server decides what the stored reason is, and a
    // non-web caller does not go through that textarea at all.
    await discardRecordingWithReason({ ...WITH_REASON, reason: '  録り直します  ' })
    expect(discardLedger[0].reason).toBe('録り直します')
  })

  it('refuses a STAFF discard with no session id — there is nowhere to key the row', async () => {
    const noSession: Record<string, unknown> = { ...WITH_REASON, takeId: 'take-1' }
    delete noSession.recordingSessionId
    expect(await discardRecordingWithReason(noSession)).toEqual({ ok: false, error: 'validation' })
    expect(discardCreate).not.toHaveBeenCalled()
    expect(discardRows()).toHaveLength(0)
  })

  it('refuses a caller-supplied discardRowId (only a real create can produce one)', async () => {
    expect(await discardRecordingWithReason({ ...WITH_REASON, discardRowId: 'forged' })).toEqual({
      ok: false,
      error: 'validation',
    })
    expect(discardRows()).toHaveLength(0)
  })

  it('an unattributable staff discard is refused before anything is read or written', async () => {
    const res = await discardRecordingWithReasonRow(
      fakeClient as never,
      { ...staffActor, staffId: null },
      WITH_REASON,
    )

    expect(res).toEqual({ ok: false, error: 'forbidden' })
    expect(discardList).not.toHaveBeenCalled()
    expect(discardCreate).not.toHaveBeenCalled()
    expect(auditLog).not.toHaveBeenCalled()
  })

  it('a caller without records.write cannot file one', async () => {
    capabilities.current = new Set(['customers.view'])

    expect(await discardRecordingWithReason(WITH_REASON)).toEqual({ ok: false, error: 'forbidden' })
    expect(discardCreate).not.toHaveBeenCalled()
  })

  it('a FAILED probe still files the reason (losing it would be worse than a duplicate)', async () => {
    discardList.mockRejectedValueOnce(new Error('core read down'))
    const res = await quiet(() => discardRecordingWithReason(WITH_REASON))

    expect(res).toMatchObject({ ok: true })
    expect(discardLedger).toHaveLength(1)
  })

  it('a create that hands back no row id fails closed', async () => {
    discardCreate.mockImplementationOnce(async () => undefined as never)
    const res = await discardRecordingWithReason(WITH_REASON)

    expect(res).toEqual({ ok: false, error: 'discard_row_failed' })
    expect(discardRows()).toHaveLength(0)
  })
})

// ── 9. A STAFF receipt cannot be MINTED from outside (fix round 1, FIX-4) ───
// `discard_row_id` + `has_free_text: true` is a claim that a written reason
// exists. Only this module can make it, because only this module writes the
// row. Before the vouch, the receipt-only door took a STAFF body straight from
// a request: an authenticated records.write caller could file a receipt
// pointing at a row id they invented, on a session with no reason anywhere —
// the exact dishonesty discard.ts's header says must be impossible.

describe('the public doors cannot reach the STAFF arm', () => {
  it('the WEB receipt-only door refuses a STAFF shape with a forged row id', async () => {
    expect(await discardRecordingReceipt({ ...VALID, discardRowId: 'forged' })).toEqual({
      ok: false,
      error: 'validation',
    })
    expect(discardRows()).toHaveLength(0)
    expect(discardLedger).toHaveLength(0)
  })

  it('the FACADE receipt-only door refuses it too — same chokepoint, same answer', async () => {
    const res = await post({ ...VALID, discardRowId: 'forged' })

    expect(res.status).toBe(400)
    expect(discardRows()).toHaveLength(0)
    expect(discardLedger).toHaveLength(0)
  })

  // Not just the forged id: the STAFF arm is unreachable from outside AT ALL,
  // including with the row id this very suite's ledger would mint.
  it('refuses a STAFF shape even when its row id is one that really exists', async () => {
    await discardRecordingWithReason({ ...WITH_REASON, recordingSessionId: 'rs-9' })
    expect(discardLedger).toHaveLength(1)
    const realRowId = discardLedger[0].id
    coreRows.length = 0

    expect(await discardRecordingReceipt({ ...VALID, discardRowId: realRowId })).toEqual({
      ok: false,
      error: 'validation',
    })
    expect(discardRows()).toHaveLength(0)
  })

  // The STAFF arm's own `.strict()` is now belt behind the reason door's
  // braces — a hostile key can only ever arrive THERE, so that is where the
  // refusal has to be pinned or a widened schema goes unnoticed.
  it.each(['note', 'comment', 'freeText', 'category', 'system_emitted', 'belowFloor', 'has_free_text'])(
    'the reason door refuses the unknown key %s',
    async (field) => {
      expect(await discardRecordingWithReason({ ...WITH_REASON, [field]: 'anything' })).toEqual({
        ok: false,
        error: 'validation',
      })
      expect(discardCreate).not.toHaveBeenCalled()
      expect(discardRows()).toHaveLength(0)
    },
  )
})

// ── 10. The facade routes on `reason`, and only on `reason` ────────────────
// route.ts decides per request which door a body takes, and its own comment
// names the stake: "the phone and the web page must not be able to drift into
// different discard semantics". Nothing used to post a body carrying a reason,
// so the entire phone path — thin port → facade → reason door — was unproven.

describe('facade reason-door routing', () => {
  it('a body WITH a reason takes the written-reason door', async () => {
    const res = await post(WITH_REASON)

    expect(res.status).toBe(200)
    expect(discardCreate).toHaveBeenCalledTimes(1)
    expect(discardCreate.mock.calls[0][0]).toMatchObject({
      recording_session_id: 'rs-1',
      source: 'STAFF',
      discarded_by: 'auth-user-1',
      reason: WITH_REASON.reason,
    })
    expect((discardRows()[0].detail as Record<string, unknown>).discard_row_id).toBe('dr-1')
  })

  it('a body WITHOUT one takes the receipt-only door — no ledger row is written', async () => {
    const res = await post(SYSTEM_VALID)

    expect(res.status).toBe(200)
    expect(discardCreate).not.toHaveBeenCalled()
    expect(discardLedger).toHaveLength(0)
    expect((discardRows()[0].detail as Record<string, unknown>).discard_row_id).toBeNull()
  })
})
