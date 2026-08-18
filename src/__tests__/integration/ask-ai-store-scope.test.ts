/**
 * Store-scope parity (packet 2026-08-17, item 3; guard fix 2026-08-17 P-1):
 * the Ask-AI scope counts (顧客/予約/カルテ) filter by store ONLY when the
 * caller is actually clamped (allowedStoreIds non-null) — the same guarded
 * lens the Ask-AI chat routes use (src/app/api/ai/chat/route.ts:80-81). A
 * viewAll actor keeps business-wide counts even with a concrete active store
 * pinned (resolveStoreScope always resolves viewAll's storeId to
 * active-or-primary, never null, so gating on storeId alone would wrongly
 * filter them).
 */
jest.mock('next-intl/server', () => ({
  getTranslations: jest.fn(async () => (k: string) => k),
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('@/actions/org-settings', () => ({ getOrgSettings: jest.fn(async () => null) }))
jest.mock('@/lib/auth/require-permission', () => ({
  getMyCapabilities: jest.fn(async () => new Set(['askAi.use'])),
}))
jest.mock('@/lib/auth/permissions', () => ({ canUseAskAi: () => true }))
jest.mock('@/lib/karute/ai-signals', () => ({ getTodaySignals: jest.fn(async () => []) }))
jest.mock('@/lib/welcome/business-types', () => ({
  getBusinessProfile: jest.fn(() => null),
  getConsultationQuestions: jest.fn(() => []),
}))
jest.mock('@/lib/perf/render-stamp', () => ({ renderStamp: () => 0 }))
// Real AIAssistantView pulls in next-intl's ESM react-client build via
// AIInputBar — out of scope here and unrelated to the store-lens fix; the
// page's createElement call never executes the component body anyway.
jest.mock('@/components/ai/redesign/AIAssistantView', () => ({
  AIAssistantView: () => null,
}))

type Scope = { storeId: string | null; viewAll: boolean; allowedStoreIds: string[] | null }
const resolveStoreScope = jest.fn<Promise<Scope>, []>(async () => ({
  storeId: null,
  viewAll: true,
  allowedStoreIds: null,
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: () => resolveStoreScope(),
}))

const karuteList = jest.fn(async () => ({ total: 0, karute_records: [] }))
const customersList = jest.fn(async () => ({ total: 0 }))
const appointmentsList = jest.fn(async () => ({ total: 0 }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({
    karuteRecords: { list: karuteList },
    customers: { list: customersList },
    appointments: { list: appointmentsList },
  })),
}))

import AskAIPage from '@/app/[locale]/(app)/ask-ai/page'

beforeEach(() => jest.clearAllMocks())

describe('Ask-AI scope counts — store lens (web)', () => {
  it('a clamped viewer\'s active store threads into every count read', async () => {
    resolveStoreScope.mockResolvedValue({ storeId: 'store-A', viewAll: false, allowedStoreIds: ['store-A'] })
    await AskAIPage({ params: Promise.resolve({ locale: 'ja' }) })
    expect(karuteList).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-A' }))
    expect(customersList).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-A' }))
    expect(appointmentsList).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-A' }))
  })

  it('allowedStoreIds: null with no storeId at all: unchanged business-wide totals (store_id undefined)', async () => {
    resolveStoreScope.mockResolvedValue({ storeId: null, viewAll: true, allowedStoreIds: null })
    await AskAIPage({ params: Promise.resolve({ locale: 'ja' }) })
    expect(customersList).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
  })

  it('viewAll actor WITH a concrete active store still gets business-wide counts (store_id undefined on all three reads)', async () => {
    resolveStoreScope.mockResolvedValue({ storeId: 'store-A', viewAll: true, allowedStoreIds: null })
    await AskAIPage({ params: Promise.resolve({ locale: 'ja' }) })
    expect(karuteList).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
    expect(customersList).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
    expect(appointmentsList).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
  })

  it('floating staff (empty assignment) WITH a concrete active store still gets business-wide counts', async () => {
    resolveStoreScope.mockResolvedValue({ storeId: 'store-A', viewAll: false, allowedStoreIds: null })
    await AskAIPage({ params: Promise.resolve({ locale: 'ja' }) })
    expect(karuteList).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
    expect(customersList).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
    expect(appointmentsList).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
  })
})
