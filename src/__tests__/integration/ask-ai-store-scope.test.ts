/**
 * Store-scope parity (packet 2026-08-17, item 3): the Ask-AI scope counts
 * (顧客/予約/カルテ) must follow the SAME active-store lens the customer/karute
 * list pages use — not a business-wide count. Web (resolveStoreScope) and the
 * facade route (resolveStoreForRequest) both thread their resolved store_id
 * into every count read; a viewer with no pinned store / viewAll with no
 * store-id header keeps today's business-wide totals (unchanged posture,
 * same as the sibling screens routes).
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

  it('viewAll with no pinned store: unchanged business-wide totals (store_id undefined)', async () => {
    resolveStoreScope.mockResolvedValue({ storeId: null, viewAll: true, allowedStoreIds: null })
    await AskAIPage({ params: Promise.resolve({ locale: 'ja' }) })
    expect(customersList).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
  })
})
