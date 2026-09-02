/**
 * Store-scope (RBAC) clamp + explicit auth guard on the AI context READS.
 *
 * The chat + insights routes used to LIST recent karute + customers with NO
 * store predicate at all — a branch-restricted staff's AI answers could draw on
 * every store's data (same leak class as the appointments one, but through the
 * model context). These tests pin PKT-004:
 *   - a clamped staff (allowedStoreIds non-null) → both list reads carry their
 *     store_id,
 *   - viewAll / floating staff (allowedStoreIds null) → no filter, byte-identical
 *     to pre-change (owner sees every store),
 *   - the chat route rejects anon callers with a clean 401 before any data work,
 *   - getRecentKaruteForAI forwards its optional storeId to karuteRecords.list.
 */

jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(),
}))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}))
// getBusinessId (real impl) hits a REAL Supabase network call via
// createServiceClient() — unmocked, it fires on every success-path POST (the
// route's trailing auditWeb → resolveWebBusinessId call) against the dummy
// test host, failing closed to null today but as an uncontrolled real
// round-trip per test — the exact class of CI-runner-load 5s timeout flake
// documented in CLOCKPROOF-PR814-AI-STORE-SCOPE-2026-09-02.md. Stub only
// getBusinessId; resolveUserId's real impl already resolves fast off the
// createClient mock above, so it stays live.
jest.mock('@/lib/staff', () => ({
  ...jest.requireActual('@/lib/staff'),
  getBusinessId: jest.fn(async () => 'business-1'),
}))
// The chat route's H0 Ask-AI capability guard — granted here so the scope pins
// keep exercising the post-guard body; denial itself is pinned in
// ask-ai-authz.test.ts.
jest.mock('@/lib/auth/require-permission', () => ({
  ...jest.requireActual('@/lib/auth/require-permission'),
  getMyCapabilities: jest.fn(async () => new Set(['customers.view'])),
}))
jest.mock('@/lib/ai-rate-limit', () => ({
  enforceAiRateLimit: jest.fn(async () => null),
  reportAiUsage: jest.fn(),
}))
jest.mock('@/lib/karute/ai-context', () => ({
  getRecentKaruteForAI: jest.fn(async () => []),
  // context-hint helpers the route now imports (PKT-101); the no-hint path only
  // calls formatKaruteContext, so the others just need to exist.
  getCustomerKaruteForAI: jest.fn(async () => ({ customerName: null, rows: [] })),
  getTodayRosterKaruteForAI: jest.fn(async () => ({ rosterSize: 0, rows: [] })),
  formatKaruteContext: jest.fn(() => ''),
}))
jest.mock('@/lib/prompts', () => ({
  getChatSystemPrompt: jest.fn(() => 'system'),
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ business_type: 'beauty_chiropractic' })),
}))
jest.mock('@/lib/openai', () => ({
  openai: {
    chat: {
      completions: {
        create: jest.fn(async () => ({
          choices: [{ message: { content: 'ok' } }],
          usage: null,
        })),
      },
    },
  },
}))
jest.mock('@/lib/synqed/client', () => {
  const customers = { list: jest.fn(async () => ({ customers: [] })) }
  const client = { customers }
  return { getSynqedClient: jest.fn(async () => client) }
})

import { POST } from '@/app/api/ai/chat/route'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { createClient } from '@/lib/supabase/server'
import { getRecentKaruteForAI } from '@/lib/karute/ai-context'
import { getSynqedClient } from '@/lib/synqed/client'

const scopeMock = resolveStoreScope as jest.Mock
const createClientMock = createClient as jest.Mock
const karuteForAiMock = getRecentKaruteForAI as jest.Mock

const GINZA = 'store-ginza'

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
function clampedToGinza() {
  scopeMock.mockResolvedValue({ storeId: GINZA, viewAll: false, allowedStoreIds: [GINZA] })
}
function viewAll(pinned: string | null) {
  scopeMock.mockResolvedValue({ storeId: pinned, viewAll: true, allowedStoreIds: null })
}

function req() {
  return new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'x', locale: 'ja' }),
  })
}

async function customersMock() {
  const client = await (getSynqedClient as jest.Mock)()
  return client.customers as { list: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('chat route — auth guard', () => {
  it('anon POST → 401, no data reads', async () => {
    anon()
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(karuteForAiMock).not.toHaveBeenCalled()
  })
})

describe('chat route — store scope', () => {
  // Third arg = the runKaruteChat core's contextDeps pass-through (F-9b) —
  // undefined on the web/cookie route.
  it('clamped staff: both list reads carry their store_id', async () => {
    signedIn()
    clampedToGinza()
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(karuteForAiMock).toHaveBeenCalledWith(5, GINZA, undefined)
    const { list } = await customersMock()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA }))
  })

  it('viewAll (no pin): no filter — behavior unchanged', async () => {
    signedIn()
    viewAll(null)
    await POST(req())
    expect(karuteForAiMock).toHaveBeenCalledWith(5, undefined, undefined)
    const { list } = await customersMock()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
  })

  it('viewAll pinned to a store: still unfiltered (AI context is business-wide for owners)', async () => {
    signedIn()
    viewAll(GINZA) // owner's active-store cookie must NOT clamp their AI context
    await POST(req())
    expect(karuteForAiMock).toHaveBeenCalledWith(5, undefined, undefined)
  })
})
