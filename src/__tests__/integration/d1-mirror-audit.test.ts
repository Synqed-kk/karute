// Wave W3 — D1 mirrors (consent grant/revoke, lifecycle, outcome). Proves:
//   (a) the four FACADE_AUDIT_MAP rows are LIVE and content-identical to
//       their parked shape (pendingWave dropped, nothing else changed —
//       the CP8 free-promotion pin);
//   (b) a facade success on each key emits exactly one line via the generic
//       hook, stamping params.id as the target — and karute.outcome.set
//       carries customer_id through the ctx.auditDetail seam;
//   (c) each web wrapper twin emits exactly once on success and NEVER on
//       its no-staff / core-failure / not-ok paths.
// Per-surface emit law (see the mirror-block comment in audit.ts): the
// WithClient cores stay audit-free; a save-embedded outcome write is
// row-less on both surfaces (karute.save covers it).
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('next-intl/server', () => ({
  getTranslations: jest.fn(async () => (k: string) => k),
}))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn(async () => undefined) }))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
  getStaffList: jest.fn(async () => []),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => new Set(['customers.view', 'records.write'])),
  requireCapability: jest.fn(async () => undefined),
  ensureCapability: jest.fn(() => undefined),
}))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(),
  newSynqedClient: jest.fn(),
}))
jest.mock('@/lib/packs/store', () => ({
  setCustomerLifecycleWithClient: jest.fn(),
}))
jest.mock('@/lib/karute/outcome', () => ({
  setKaruteOutcome: jest.fn(),
}))

import { createHmac } from 'node:crypto'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { FACADE_AUDIT_MAP } from '@/lib/audit'
import type { VerifierConfig } from '@/lib/auth/verify-bearer'
import { auditLines } from './helpers/audit-lines'
import { grantCustomerConsent, revokeCustomerConsent } from '@/actions/customers'
import { setLifecycleAction } from '@/actions/packs'
import { updateKaruteOutcome } from '@/actions/karute-outcome'
import { auditWeb as auditWebImport } from '@/lib/audit-web'
import { getCurrentUserStaffId as getCurrentUserStaffIdImport } from '@/lib/staff'
import { getSynqedClient as getSynqedClientImport } from '@/lib/synqed/client'
import { setCustomerLifecycleWithClient as setCustomerLifecycleWithClientImport } from '@/lib/packs/store'
import { setKaruteOutcome as setKaruteOutcomeImport } from '@/lib/karute/outcome'

const auditWeb = auditWebImport as jest.Mock
const getCurrentUserStaffId = getCurrentUserStaffIdImport as jest.Mock
const getSynqedClient = getSynqedClientImport as jest.Mock
const setCustomerLifecycleWithClient = setCustomerLifecycleWithClientImport as jest.Mock
const setKaruteOutcome = setKaruteOutcomeImport as jest.Mock

// ── (a) content-identical promotion pins ────────────────────────────────────

describe('FACADE_AUDIT_MAP — D1 mirror rows are LIVE (Wave W3)', () => {
  // toEqual is exact: any extra field (a lingering pendingWave, a changed
  // action/category/targetType) fails — this IS the free-promotion proof.
  it.each([
    ['customer.consent.grant', { kind: 'mutation', category: 'customer', action: 'customer.consent_grant', targetType: 'customer' }],
    ['customer.consent.revoke', { kind: 'mutation', category: 'customer', action: 'customer.consent_revoke', targetType: 'customer' }],
    ['customer.lifecycle.set', { kind: 'mutation', category: 'customer', action: 'customer.lifecycle_set', targetType: 'customer' }],
    ['karute.outcome.set', { kind: 'mutation', category: 'karute', action: 'karute.outcome_set', targetType: 'karute' }],
  ] as const)('%s is live, content-identical to its parked shape', (key, shape) => {
    expect(FACADE_AUDIT_MAP[key]).toEqual(shape)
  })
})

// ── (b) facade hook emits ───────────────────────────────────────────────────

const ISSUER = 'https://testproj.supabase.co/auth/v1'
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

function hs256Token(secret: string) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: 'u1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

const SECRET = 'test-jwt-secret-do-not-use-in-prod'
const HS_CONFIG: VerifierConfig = { issuer: ISSUER, audience: 'authenticated', hs256Secret: SECRET, algorithms: ['HS256'] }
const authedReq = () =>
  new Request('https://s/api/app/v1/x', { headers: { authorization: `Bearer ${hs256Token(SECRET)}` } })
const route = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) })

describe('facade hook — D1 mirror keys emit on 2xx (Wave W3)', () => {
  it.each([
    ['customer.consent.grant', 'customer.consent_grant', 'customer'],
    ['customer.consent.revoke', 'customer.consent_revoke', 'customer'],
    ['customer.lifecycle.set', 'customer.lifecycle_set', 'customer'],
  ] as const)('%s emits %s stamping params.id', async (key, action, targetType) => {
    const handler = facadeHandler(key, async (ctx) => ok(ctx, { ok: true }), {
      config: HS_CONFIG,
      getUser: async () => ({ id: 'u1' }),
    })
    const lines = await auditLines(async () => {
      const res = await handler(authedReq(), route({ id: 'cus-9' }))
      expect(res.status).toBe(200)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action,
      target_type: targetType,
      target_id: 'cus-9',
      source: 'facade',
    })
  })

  it('karute.outcome.set emits karute.outcome_set with customer_id via the auditDetail seam', async () => {
    const handler = facadeHandler(
      'karute.outcome.set',
      async (ctx) => {
        ctx.auditDetail = { customer_id: 'cus-7' }
        return ok(ctx, { ok: true })
      },
      { config: HS_CONFIG, getUser: async () => ({ id: 'u1' }) },
    )
    const lines = await auditLines(() => handler(authedReq(), route({ id: 'kar-3' })))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'karute.outcome_set',
      target_type: 'karute',
      target_id: 'kar-3',
      source: 'facade',
    })
    expect(lines[0].detail).toMatchObject({ customer_id: 'cus-7' })
  })
})

// ── (c) web wrapper twins ───────────────────────────────────────────────────

const synqedCustomers = { grantConsent: jest.fn(), revokeConsent: jest.fn() }
const synqedKaruteRecords = { get: jest.fn() }

beforeEach(() => {
  jest.clearAllMocks()
  getCurrentUserStaffId.mockImplementation(async () => 'staff-1')
  getSynqedClient.mockImplementation(async () => ({ customers: synqedCustomers, karuteRecords: synqedKaruteRecords }))
  synqedCustomers.grantConsent.mockResolvedValue({ id: 'consent-1' })
  synqedCustomers.revokeConsent.mockResolvedValue(undefined)
  synqedKaruteRecords.get.mockResolvedValue({ id: 'kar-1', customer_id: 'cus-4' })
  setCustomerLifecycleWithClient.mockResolvedValue({ ok: true })
  setKaruteOutcome.mockResolvedValue({})
})

describe('grantCustomerConsent — web twin (Wave W3)', () => {
  it('success: auditWeb exactly once with customer.consent_grant + the customer target', async () => {
    const res = await grantCustomerConsent('cus-1', { method: 'VERBAL' })
    expect(res.ok).toBe(true)
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'customer',
        action: 'customer.consent_grant',
        targetType: 'customer',
        targetId: 'cus-1',
      }),
    )
  })

  it('no staff identity: fails closed, auditWeb never called', async () => {
    getCurrentUserStaffId.mockImplementation(async () => null)
    const res = await grantCustomerConsent('cus-1')
    expect(res.ok).toBe(false)
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('core failure: auditWeb never called', async () => {
    synqedCustomers.grantConsent.mockRejectedValue(new Error('boom'))
    const res = await grantCustomerConsent('cus-1')
    expect(res.ok).toBe(false)
    expect(auditWeb).not.toHaveBeenCalled()
  })
})

describe('revokeCustomerConsent — web twin (Wave W3)', () => {
  it('success: auditWeb exactly once with customer.consent_revoke + the customer target', async () => {
    const res = await revokeCustomerConsent('cus-2')
    expect(res.ok).toBe(true)
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'customer',
        action: 'customer.consent_revoke',
        targetType: 'customer',
        targetId: 'cus-2',
      }),
    )
  })

  it('no staff identity: fails closed, auditWeb never called', async () => {
    getCurrentUserStaffId.mockImplementation(async () => null)
    const res = await revokeCustomerConsent('cus-2')
    expect(res.ok).toBe(false)
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('core failure: auditWeb never called', async () => {
    synqedCustomers.revokeConsent.mockRejectedValue(new Error('boom'))
    const res = await revokeCustomerConsent('cus-2')
    expect(res.ok).toBe(false)
    expect(auditWeb).not.toHaveBeenCalled()
  })
})

describe('setLifecycleAction — web twin (Wave W3)', () => {
  const input = { customerId: 'cus-3', status: 'ACTIVE' as never, referral: false }

  it('success: auditWeb exactly once with customer.lifecycle_set + the customer target', async () => {
    const res = await setLifecycleAction(input)
    expect(res.ok).toBe(true)
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'customer',
        action: 'customer.lifecycle_set',
        targetType: 'customer',
        targetId: 'cus-3',
      }),
    )
  })

  it('core not-ok: auditWeb never called', async () => {
    setCustomerLifecycleWithClient.mockResolvedValue({ ok: false })
    const res = await setLifecycleAction(input)
    expect(res.ok).toBe(false)
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('empty customerId: the WithClient guard fails closed, no write, no emit', async () => {
    const res = await setLifecycleAction({ ...input, customerId: '' })
    expect(res.ok).toBe(false)
    expect(setCustomerLifecycleWithClient).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })
})

describe('updateKaruteOutcome — web twin (Wave W3)', () => {
  const outcome = { status: 'success' as const, reason: null, isFirstVisit: false }

  it('success: auditWeb exactly once with karute.outcome_set, karute target + the DERIVED customer_id detail', async () => {
    const res = await updateKaruteOutcome('kar-1', outcome)
    expect(res.error).toBeUndefined()
    // The customer is derived from the record (facade parity — never
    // caller-supplied): both the write and the row carry the record's id.
    expect(synqedKaruteRecords.get).toHaveBeenCalledWith('kar-1')
    expect(setKaruteOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ karuteRecordId: 'kar-1', customerId: 'cus-4' }),
    )
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'karute',
        action: 'karute.outcome_set',
        targetType: 'karute',
        targetId: 'kar-1',
        detail: { customer_id: 'cus-4' },
      }),
    )
  })

  it('record not found (or cross-tenant): fails before any write, auditWeb never called', async () => {
    synqedKaruteRecords.get.mockRejectedValue(new Error('404'))
    const res = await updateKaruteOutcome('kar-9', outcome)
    expect(res.error).toBe('karute record not found')
    expect(setKaruteOutcome).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('record with no linked customer: fails before any write, auditWeb never called', async () => {
    synqedKaruteRecords.get.mockResolvedValue({ id: 'kar-1', customer_id: null })
    const res = await updateKaruteOutcome('kar-1', outcome)
    expect(res.error).toBe('karute has no linked customer')
    expect(setKaruteOutcome).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('outcome-write failure: the error passes through, auditWeb never called', async () => {
    setKaruteOutcome.mockResolvedValue({ error: 'outcome write failed' })
    const res = await updateKaruteOutcome('kar-1', outcome)
    expect(res.error).toBe('outcome write failed')
    expect(auditWeb).not.toHaveBeenCalled()
  })
})
