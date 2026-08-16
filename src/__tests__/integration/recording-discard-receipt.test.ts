// Recording-integrity PR A1 — the disclosed-discard RECEIPT (spec §3.6, §10).
//
// The receipt IS the product here, so these tests assert the properties a
// trace-grade audit row never has to carry: exactly ONE row per discard across
// BOTH doors, a DURABLE row before any success is reported, silent-success
// idempotency, and a detail payload that is ids/flags/counts and nothing else.
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
const fakeClient = { audit: new ThisSensitiveAuditClient(auditLog, auditList) }

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

import { discardRecordingReceipt } from '@/actions/recording-discard'
import { discardRecordingWithClient } from '@/lib/recording/discard'
import { POST as discardPOST } from '@/app/api/app/v1/recordings/discard/route'
import { FACADE_AUDIT_MAP } from '@/lib/audit'

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

const VALID = {
  recordingSessionId: 'rs-1',
  category: 'mistap' as const,
  durationSeconds: 12.4,
  customerId: 'cust-1',
  appointmentId: 'appt-1',
  pipeline: 'in_tab' as const,
  jobState: null,
}

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
  logFails.next = false
  capabilities.current = new Set(['customers.view', 'records.write'])
})

// ── 1. Both doors, exactly one row each (T6/T9 slice) ──────────────────────

describe('one discard = exactly one recording.discard row', () => {
  it('the WEB action writes one durable row carrying the §10.3 detail', async () => {
    const res = await discardRecordingReceipt(VALID)

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
        category: 'mistap',
        duration_sec: 12,
        below_floor: false, // 12.4s is at or above the §3.5 floor
        route: 'operational',
        pipeline: 'in_tab',
        job_state: null,
        has_free_text: false,
        system_emitted: false,
      },
    })
  })

  it('the FACADE route writes one row — the on-2xx hook does NOT add a second', async () => {
    const res = await post(VALID)
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
    expect(Object.keys(actionsModule)).toEqual(['discardRecordingReceipt'])

    const source = readFileSync(join(process.cwd(), 'src/lib/recording/discard.ts'), 'utf8')
    expect(source).not.toMatch(/^\s*['"]use server['"]/m)
  })

  it('the facade row carries the SERVER-minted requestId, not a client-supplied one', async () => {
    const res = await post(VALID, { ...auth, 'request-id': 'forged-by-client' })
    const detail = auditLog.mock.calls[0][0].detail as Record<string, unknown>
    // Pinned to the ACTUAL ctx.meta.requestId, which the handler echoes on the
    // response — "not the forged one" alone would pass on any random value.
    const minted = res.headers.get('request-id')
    expect(minted).toBeTruthy()
    expect(detail.request_id).toBe(minted)
    expect(detail.request_id).not.toBe('forged-by-client')
  })

  it('scopes the core client to the CALLER’s business, never a body-supplied one', async () => {
    await post({ ...VALID, businessId: 'someone-elses-business' })
    // (the extra key also proves .strict() rejects it — hence no row)
    expect(discardRows()).toHaveLength(0)

    await post(VALID)
    expect(newSynqedClientSpy).toHaveBeenCalledWith('business-1')
    expect(auditLog.mock.calls[0][0]).toMatchObject({ actor_id: 'auth-user-1' })
  })

  it('falls back to the minted requestId when core returns no row id', async () => {
    auditLog.mockImplementationOnce(async () => undefined)
    const res = await discardRecordingWithClient(fakeClient as never, webActor, VALID)

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
    const first = await discardRecordingReceipt(VALID)
    expect(first).toMatchObject({ ok: true, duplicate: false })

    const second = await discardRecordingReceipt(VALID)

    expect(second).toEqual({ ok: true, receiptId: 'row-1', duplicate: true })
    expect(discardRows()).toHaveLength(1) // zero new writes
  })

  it('holds for the takeId-only (pre-mint) case too', async () => {
    const preMint = { ...VALID, recordingSessionId: null, takeId: 'take-9' }
    await discardRecordingWithClient(fakeClient as never, webActor, preMint)
    const second = await discardRecordingWithClient(fakeClient as never, webActor, preMint)

    expect(second).toMatchObject({ ok: true, duplicate: true })
    expect(discardRows()).toHaveLength(1)
    expect(discardRows()[0].target_id).toBe('take-9')
    expect((discardRows()[0].detail as Record<string, unknown>).take_id).toBe('take-9')
  })

  it('crosses the two doors — a web discard then the facade one is still one row', async () => {
    await discardRecordingReceipt(VALID)
    const res = await post(VALID)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ receiptId: 'row-1', duplicate: true })
    expect(discardRows()).toHaveLength(1)
  })

  it('a DIFFERENT take is not deduped against an existing receipt', async () => {
    await discardRecordingReceipt(VALID)
    const other = await discardRecordingReceipt({ ...VALID, recordingSessionId: 'rs-2' })

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

    const res = await discardRecordingReceipt(VALID)

    expect(res).toMatchObject({ ok: true, duplicate: false })
    expect(discardRows().filter((r) => r.target_id === 'rs-1')).toHaveLength(1)
  })

  it('a pre-mint receipt filed under takeId dedupes the post-mint retry carrying BOTH ids', async () => {
    // Offline discard before the session was minted → receipt keyed on take_id.
    const preMint = { ...VALID, recordingSessionId: null, takeId: 'take-7' }
    const first = await discardRecordingReceipt(preMint)
    expect(first).toMatchObject({ ok: true, duplicate: false })

    // The retry now knows its session id too. Probing only the session id would
    // miss the existing receipt and write a second row for the same take.
    const retry = await discardRecordingReceipt({ ...VALID, recordingSessionId: 'rs-1', takeId: 'take-7' })

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
    const res = await discardRecordingReceipt(VALID)
    warn.mockRestore()

    expect(res).toEqual({ ok: false, error: 'receipt_write_failed' })
    expect(discardRows()).toHaveLength(0)
  })

  it('the facade route returns a NON-2xx', async () => {
    logFails.next = true
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post(VALID)
    warn.mockRestore()

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).not.toBe(200)
    expect(discardRows()).toHaveLength(0)
  })
})

// ── 4. system_emitted is SERVER-derived (spec §3.2) ────────────────────────

describe('system_emitted derivation', () => {
  it("'abandoned' is accepted and derives system_emitted: true", async () => {
    const res = await discardRecordingReceipt({ ...VALID, category: 'abandoned' })

    expect(res).toMatchObject({ ok: true })
    expect((discardRows()[0].detail as Record<string, unknown>).system_emitted).toBe(true)
    // The actor stays the take's OWNER, not 'system' (spec §3.7).
    expect(discardRows()[0].actor_type).toBe('staff')
    expect(discardRows()[0].actor_id).toBe('auth-user-1')
  })

  it.each(['mistap', 'quality', 'duplicate', 'wrong_target', 'not_session'])(
    "every staff category (%s) derives system_emitted: false",
    async (category) => {
      await discardRecordingReceipt({ ...VALID, category })
      expect((discardRows()[0].detail as Record<string, unknown>).system_emitted).toBe(false)
    },
  )

  it('a client-supplied system_emitted is REFUSED, never honoured', async () => {
    const res = await discardRecordingReceipt({ ...VALID, system_emitted: true })

    expect(res).toEqual({ ok: false, error: 'validation' })
    expect(discardRows()).toHaveLength(0)
  })
})

// ── 5. Validation (Phase A schema — there is no free-text field) ───────────

describe('input validation', () => {
  it('refuses an unknown category', async () => {
    expect(await discardRecordingReceipt({ ...VALID, category: 'because_i_felt_like_it' })).toEqual({
      ok: false,
      error: 'validation',
    })
    expect(discardRows()).toHaveLength(0)
  })

  it.each(['reason', 'note', 'comment', 'freeText'])('refuses a free-text-shaped field (%s)', async (field) => {
    expect(await discardRecordingReceipt({ ...VALID, [field]: 'the customer asked me to delete it' })).toEqual({
      ok: false,
      error: 'validation',
    })
    expect(discardRows()).toHaveLength(0)
  })

  it('refuses a receipt with no take key at all', async () => {
    const noKey: Record<string, unknown> = { ...VALID }
    delete noKey.recordingSessionId
    expect(await discardRecordingReceipt(noKey)).toEqual({ ok: false, error: 'validation' })
    // …and an explicitly-nulled pair is just as keyless.
    expect(await discardRecordingReceipt({ ...VALID, recordingSessionId: null, takeId: null })).toEqual({
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
    const res = await post({ ...VALID, category: 'nope' })
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
    await discardRecordingReceipt({ ...VALID, takeId: 'take-1', jobState: 'QUEUED' })
    const detail = discardRows()[0].detail as Record<string, unknown>

    for (const [key, value] of Object.entries(detail)) {
      expect(['string', 'number', 'boolean']).toContain(value === null ? 'string' : typeof value)
      expect(key).toBe(key.toLowerCase()) // snake_case keys, the detail-key convention
    }
  })

  it('the detail key set is exactly spec §10.3 (plus the request_id correlation key)', async () => {
    await discardRecordingReceipt(VALID)
    const detail = discardRows()[0].detail as Record<string, unknown>

    expect(Object.keys(detail).sort()).toEqual(
      [
        'appointment_id',
        'below_floor',
        'category',
        'customer_id',
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

  it('duration is a whole-second COUNT, never a raw float', async () => {
    await discardRecordingReceipt({ ...VALID, durationSeconds: 12.987 })
    expect((discardRows()[0].detail as Record<string, unknown>).duration_sec).toBe(13)
  })

  it('has_free_text is always false in Phase A (there is no field that could set it)', async () => {
    await discardRecordingReceipt(VALID)
    expect((discardRows()[0].detail as Record<string, unknown>).has_free_text).toBe(false)
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
    await discardRecordingReceipt({ ...VALID, durationSeconds })
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

// ── jobState is a closed set (CO-2) ────────────────────────────────────────

describe('jobState', () => {
  it.each(['QUEUED', 'RUNNING', 'DONE', 'FAILED'])('accepts the real pipeline state %s', async (jobState) => {
    await discardRecordingReceipt({ ...VALID, jobState })
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
    await discardRecordingReceipt(VALID)
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
    const res = await discardRecordingReceipt(VALID)
    warn.mockRestore()

    expect(res).toMatchObject({ ok: true, duplicate: false })
    expect(discardRows()).toHaveLength(1)
  })
})
