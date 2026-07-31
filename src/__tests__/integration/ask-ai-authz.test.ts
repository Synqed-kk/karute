/**
 * H0 Ask-AI authorization (2026-07-30) — the shared capability rule on the two
 * surfaces that previously checked SESSION PRESENCE ONLY: the legacy cookie
 * chat route and the /ask-ai page. (The facade chat + facade screen twins
 * already enforced customers.view; their own suites pin that denial, and the
 * rule-pin test below ties all four surfaces to the same effective rule via
 * ASK_AI_REQUIRED_CAPABILITIES.)
 *
 * Rule note (deliberate, awaiting product ruling): the shared rule is
 * customers.view — exact parity with what the shipped facade twins enforce.
 * The H0 packet floated `customers.view AND records.write` (which would also
 * exclude Front Desk); that is a product-policy revocation with no current
 * ruling, so it was NOT frozen here. Flipping the rule = edit
 * ASK_AI_REQUIRED_CAPABILITIES + the truth-table pins below + the facade
 * suites' capability fixtures.
 */

// Declared before the jest.mock factories that dereference them at call time
// (same pattern as app-api-ai-chat.test.ts).
const capsScenario: { current: Set<string> | null } = { current: new Set() }

jest.mock('@/lib/auth/require-permission', () => ({
  // null → simulate a capability-resolution failure (rejects).
  getMyCapabilities: jest.fn(async () => {
    if (capsScenario.current === null) throw new Error('resolve failed')
    return capsScenario.current
  }),
}))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({ storeId: null, viewAll: true, allowedStoreIds: null })),
}))
jest.mock('@/lib/ai-rate-limit', () => ({
  enforceAiRateLimit: jest.fn(async () => null),
  reportAiUsage: jest.fn(),
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => null),
}))
jest.mock('@/lib/ai/karute-chat', () => ({
  runKaruteChat: jest.fn(async () => ({ reply: 'ok', contextLabel: undefined, usage: null })),
  parseContextHint: jest.fn(() => null),
  capHistory: jest.fn((h: unknown[]) => h),
}))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn(async () => undefined) }))
jest.mock('@/lib/synqed/client', () => {
  const client = {
    customers: { list: jest.fn(async () => ({ total: 1, customers: [] })) },
    karuteRecords: { list: jest.fn(async () => ({ total: 2, karute_records: [] })) },
    appointments: { list: jest.fn(async () => ({ total: 3 })) },
  }
  return { getSynqedClient: jest.fn(async () => client) }
})
// Page-only collaborators.
jest.mock('next-intl/server', () => ({
  getTranslations: jest.fn(async () => (key: string) => key),
}))
jest.mock('next/navigation', () => ({
  redirect: jest.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`)
  }),
}))
jest.mock('@/lib/karute/ai-signals', () => ({
  getTodaySignals: jest.fn(async () => []),
}))
jest.mock('@/lib/welcome/business-types', () => ({
  getBusinessProfile: jest.fn(() => null),
  getConsultationQuestions: jest.fn(() => []),
}))
jest.mock('@/components/ai/redesign/AIAssistantView', () => ({
  AIAssistantView: jest.fn(() => null),
}))

import { POST } from '@/app/api/ai/chat/route'
import AskAIPage from '@/app/[locale]/(app)/ask-ai/page'
import {
  ASK_AI_REQUIRED_CAPABILITIES,
  canUseAskAi,
  effectiveCapabilities,
  ROLE_PRESETS,
  type Capability,
  type PermissionRole,
} from '@/lib/auth/permissions'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { createClient } from '@/lib/supabase/server'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { enforceAiRateLimit } from '@/lib/ai-rate-limit'
import { getOrgSettings } from '@/actions/org-settings'
import { runKaruteChat } from '@/lib/ai/karute-chat'
import { auditWeb } from '@/lib/audit-web'
import { getSynqedClient } from '@/lib/synqed/client'
import { getTodaySignals } from '@/lib/karute/ai-signals'
import { redirect } from 'next/navigation'

const createClientMock = createClient as jest.Mock

function signedIn() {
  createClientMock.mockResolvedValue({
    auth: { getUser: jest.fn(async () => ({ data: { user: { id: 'u-1' } } })) },
  })
}
function anon() {
  createClientMock.mockResolvedValue({
    auth: { getUser: jest.fn(async () => ({ data: { user: null } })) },
  })
}
function grant(...caps: string[]) {
  capsScenario.current = new Set(caps)
}

function req() {
  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'x', locale: 'ja' }),
  })
}

/** The work a denied caller must never trigger. */
function expectNoWork() {
  expect(enforceAiRateLimit).not.toHaveBeenCalled()
  expect(resolveStoreScope).not.toHaveBeenCalled()
  expect(getOrgSettings).not.toHaveBeenCalled()
  expect(runKaruteChat).not.toHaveBeenCalled()
  expect(auditWeb).not.toHaveBeenCalled()
  expect(getSynqedClient).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
  grant()
})

describe('shared rule — ASK_AI_REQUIRED_CAPABILITIES', () => {
  it('is pinned to customers.view (facade parity). Changing the rule here means updating the facade suites too', () => {
    expect([...ASK_AI_REQUIRED_CAPABILITIES]).toEqual(['customers.view'])
  })

  it('canUseAskAi truth table', () => {
    expect(canUseAskAi(new Set<Capability>())).toBe(false)
    expect(canUseAskAi(new Set<Capability>(['records.write']))).toBe(false)
    expect(canUseAskAi(new Set<Capability>(['customers.view']))).toBe(true)
  })

  it('decision is capability-based, never a role label: presets resolve as documented', () => {
    const admitted: Record<PermissionRole, boolean> = {
      owner: true,
      manager: true,
      senior: true,
      practitioner: true,
      // Front Desk stays admitted under the current facade-parity rule —
      // excluding it is the open product decision recorded in the PR.
      frontdesk: true,
      custom: false,
    }
    for (const role of Object.keys(ROLE_PRESETS) as PermissionRole[]) {
      expect(canUseAskAi(effectiveCapabilities(role, null))).toBe(admitted[role])
    }
  })
})

describe('legacy cookie chat route — capability guard (H0)', () => {
  it('anon → 401 before capability resolve, and no work at all', async () => {
    anon()
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(getMyCapabilities).not.toHaveBeenCalled()
    expectNoWork()
  })

  it('blank custom account (no capabilities) → 403; no rate-limit consume, scope, settings, context, model or audit work', async () => {
    signedIn()
    grant()
    const res = await POST(req())
    expect(res.status).toBe(403)
    expectNoWork()
  })

  it('records.write-only custom account → 403 (writes do not grant AI read context)', async () => {
    signedIn()
    grant('records.write')
    const res = await POST(req())
    expect(res.status).toBe(403)
    expectNoWork()
  })

  it("capability-resolution failure → the route's own 500 envelope, never 403/200; no work", async () => {
    signedIn()
    capsScenario.current = null
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed' })
    expectNoWork()
  })

  it('customers.view-only custom account → 200 (the current shared rule — facade parity)', async () => {
    signedIn()
    grant('customers.view')
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(runKaruteChat).toHaveBeenCalled()
  })

  it('practitioner-shaped capability set → 200 (authorized use preserved)', async () => {
    signedIn()
    grant('records.write', 'customers.view', 'bookings.manage')
    const res = await POST(req())
    expect(res.status).toBe(200)
  })
})

describe('/ask-ai page — surface guard (H0)', () => {
  const params = Promise.resolve({ locale: 'ja' })

  it('denied account → redirected to dashboard, sensitive counts never preloaded', async () => {
    grant()
    await expect(AskAIPage({ params })).rejects.toThrow('NEXT_REDIRECT:/ja/dashboard')
    expect(redirect).toHaveBeenCalledWith('/ja/dashboard')
    expect(getSynqedClient).not.toHaveBeenCalled()
    expect(getOrgSettings).not.toHaveBeenCalled()
    expect(getTodaySignals).not.toHaveBeenCalled()
  })

  it('capability-resolution failure → fail closed (redirect), no preload', async () => {
    capsScenario.current = null
    await expect(AskAIPage({ params })).rejects.toThrow('NEXT_REDIRECT:/ja/dashboard')
    expect(getSynqedClient).not.toHaveBeenCalled()
  })

  it('customers.view account → page renders and loads its scope counts', async () => {
    grant('customers.view')
    const el = await AskAIPage({ params })
    expect(el).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
    const synqed = await (getSynqedClient as jest.Mock)()
    expect(synqed.karuteRecords.list).toHaveBeenCalled()
  })
})
