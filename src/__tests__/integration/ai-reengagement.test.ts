/**
 * AI再エンゲージメント generator core (src/lib/karute/ai-reengagement.ts,
 * reengagement packet §13). Mirrors ai-baseline-audit.test.ts's mocking
 * convention (openai/ai-cache/org-settings/feature-gate mocked, audit-web
 * mocked for the web twin, the REAL audit() + auditLines helper for the
 * facade twin). Covers packet Tests #1-#7 (UI-level #8/#9 live in
 * customer-reengagement-card.test.tsx).
 */
import { readFileSync } from 'fs'
import { join } from 'path'

jest.mock('@/lib/openai', () => ({
  openai: { chat: { completions: { parse: jest.fn() } } },
}))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn(async () => undefined) }))
jest.mock('@/lib/ai-cache', () => ({
  getCachedAI: jest.fn(async () => null),
  setCachedAI: jest.fn(async () => undefined),
}))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => null),
  orgSettingsWithClient: jest.fn(async () => null),
}))
jest.mock('@/lib/subscription/feature-gate', () => ({
  featureAllowed: jest.fn(async () => true),
  featureAllowedForBusiness: jest.fn(async () => true),
}))
jest.mock('@/actions/karute', () => ({
  getCustomerKaruteRecords: jest.fn(async () => []),
  getCustomerKaruteRecordsWithClient: jest.fn(async () => []),
}))
jest.mock('@/lib/karute/ai-body-prediction', () => ({
  getBodyPrediction: jest.fn(async () => null),
  getBodyPredictionWithClient: jest.fn(async () => null),
}))
jest.mock('@/lib/karute/customer-memory', () => ({ getCustomerMemory: jest.fn(async () => []) }))

import { openai } from '@/lib/openai'
import { auditLines } from './helpers/audit-lines'
import {
  getReengagementDraft,
  getReengagementDraftWithClient,
  reengagementTier,
  REENGAGE_NUDGE_MIN_DAYS,
  type ReengagementParams,
} from '@/lib/karute/ai-reengagement'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const BASE_PARAMS: ReengagementParams = {
  customerId: 'cust-1',
  customerName: '田中 花子',
  status: 'needs-followup',
  visitCount: 3,
  lastVisitAgoDays: 70,
  preferredStaffName: '佐藤',
  hasUpcomingBooking: false,
  locale: 'ja',
}

function mockDraftResolved(overrides: Partial<{ draft: string; reasoning: string; signals: unknown[] }> = {}) {
  ;(openai.chat.completions.parse as jest.Mock).mockResolvedValue({
    choices: [
      { message: { parsed: { draft: 'd', reasoning: 'r', signals: [], ...overrides } } },
    ],
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('reengagementTier table (F5) — pure, no mocks needed', () => {
  it.each([
    [46, true, 'overdue'],
    [89, true, 'overdue'],
    [90, true, 'dormant'],
    [200, true, 'dormant'],
  ] as const)('(%i, %s) → %s', (days, hasHistory, expected) => {
    expect(reengagementTier(days, hasHistory)).toBe(expected)
  })

  it('REENGAGE_NUDGE_MIN_DAYS is 61 (⚖ 8/23 — aligned to status-signals.ts\'s 要フォロー boundary)', () => {
    expect(REENGAGE_NUDGE_MIN_DAYS).toBe(61)
  })
})

describe('gate contract (Test #1) — status/day/booking exclusions run before any AI spend', () => {
  it.each([
    ['on-track', { status: 'on-track', lastVisitAgoDays: 10 }],
    ['graduated', { status: 'graduated', lastVisitAgoDays: 200 }],
    ['lost', { status: 'lost', lastVisitAgoDays: 200 }],
    ['upcoming booking (even dormant-by-days)', { status: 'dormant', lastVisitAgoDays: 200, hasUpcomingBooking: true }],
    ['new', { status: 'new', lastVisitAgoDays: null, visitCount: 0 }],
    ['zero-history at any status', { status: 'needs-followup', lastVisitAgoDays: 70, visitCount: 0 }],
    ['below the min-days threshold and not dormant', { status: 'needs-followup', lastVisitAgoDays: 60 }],
  ] as const)('%s → no card, zero OpenAI/cache spend', async (_label, overrides) => {
    const draft = await getReengagementDraft({ ...BASE_PARAMS, ...overrides })
    expect(draft).toBeNull()
    expect(openai.chat.completions.parse).not.toHaveBeenCalled()
    const { getCachedAI } = jest.requireMock('@/lib/ai-cache')
    expect(getCachedAI).not.toHaveBeenCalled()
  })

  it('needs-followup exactly at the threshold (61 days) → generates, tier=overdue', async () => {
    mockDraftResolved()
    const draft = await getReengagementDraft({ ...BASE_PARAMS, status: 'needs-followup', lastVisitAgoDays: 61 })
    expect(draft).toEqual({ draft: 'd', reasoning: 'r', signals: [], tier: 'overdue' })
  })

  it('dormant → generates, tier=dormant', async () => {
    mockDraftResolved()
    const draft = await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    expect(draft?.tier).toBe('dormant')
  })

  it('generator produces an empty draft → null (nothing to render)', async () => {
    mockDraftResolved({ draft: '   ' })
    const draft = await getReengagementDraft({ ...BASE_PARAMS, status: 'needs-followup', lastVisitAgoDays: 61 })
    expect(draft).toBeNull()
  })
})

describe('plan gate (Test #2, F8)', () => {
  it('web: featureAllowed=false → null before any AI call', async () => {
    const { featureAllowed } = jest.requireMock('@/lib/subscription/feature-gate')
    ;(featureAllowed as jest.Mock).mockResolvedValueOnce(false)
    const draft = await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    expect(draft).toBeNull()
    expect(openai.chat.completions.parse).not.toHaveBeenCalled()
  })

  it('facade: featureAllowedForBusiness=false → null before any AI call', async () => {
    const { featureAllowedForBusiness } = jest.requireMock('@/lib/subscription/feature-gate')
    ;(featureAllowedForBusiness as jest.Mock).mockResolvedValueOnce(false)
    const draft = await getReengagementDraftWithClient({} as never, 'biz-1', 'staff-1', 'req-1', {
      ...BASE_PARAMS,
      status: 'dormant',
      lastVisitAgoDays: 120,
    })
    expect(draft).toBeNull()
    expect(openai.chat.completions.parse).not.toHaveBeenCalled()
  })
})

describe('cache-key contract (Test #4, F10)', () => {
  it('a memory label edit changes the cache key; a summary change changes it too (isolated); ttlDays=1 explicit', async () => {
    const { getCustomerMemory } = jest.requireMock('@/lib/karute/customer-memory')
    const { getCustomerKaruteRecords } = jest.requireMock('@/actions/karute')
    const { getCachedAI, setCachedAI } = jest.requireMock('@/lib/ai-cache')

    const memItem = (label: string) => [
      { id: 'm1', category: 'body', label, detail: null, source: 'staff', confidence: 1, pinned: false, suggestTalkingPoint: false, updatedAt: '' },
    ]
    const session = (summary: string) => [{ id: 'k1', created_at: '2026-01-01', ai_summary: summary, edited_summary: null }]

    mockDraftResolved()
    ;(getCustomerMemory as jest.Mock).mockResolvedValueOnce(memItem('label A'))
    ;(getCustomerKaruteRecords as jest.Mock).mockResolvedValueOnce(session('summary A'))
    await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    const baseline = getCachedAI.mock.calls[0][1]
    expect(baseline.v).toBe(1)

    mockDraftResolved()
    ;(getCustomerMemory as jest.Mock).mockResolvedValueOnce(memItem('label B (edited)'))
    ;(getCustomerKaruteRecords as jest.Mock).mockResolvedValueOnce(session('summary A'))
    await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    const afterMemoryEdit = getCachedAI.mock.calls[1][1]
    expect(afterMemoryEdit).not.toEqual(baseline)
    expect(afterMemoryEdit.sessions).toEqual(baseline.sessions) // isolate: only memory changed

    mockDraftResolved()
    ;(getCustomerMemory as jest.Mock).mockResolvedValueOnce(memItem('label A'))
    ;(getCustomerKaruteRecords as jest.Mock).mockResolvedValueOnce(session('summary CHANGED'))
    await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    const afterSummaryEdit = getCachedAI.mock.calls[2][1]
    expect(afterSummaryEdit.memory).toEqual(baseline.memory) // isolate: only summary changed
    expect(afterSummaryEdit.sessions).not.toEqual(baseline.sessions)

    for (const call of setCachedAI.mock.calls) {
      expect(call[0]).toBe('reengagement_draft')
      expect(call[3]).toBe(1) // ttlDays EXPLICIT (default is 7)
    }
  })

  it('FIX ROUND 1 R1(b): visitCount joins the cache key — two surfaces disagreeing on visitCount for the same customer can no longer share a cache entry', async () => {
    const { getCachedAI } = jest.requireMock('@/lib/ai-cache')

    mockDraftResolved()
    await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120, visitCount: 8 })
    const eight = getCachedAI.mock.calls[0][1]
    expect(eight.visitCount).toBe(8)

    mockDraftResolved()
    await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120, visitCount: 30 })
    const thirty = getCachedAI.mock.calls[1][1]
    expect(thirty.visitCount).toBe(30)

    // Mutation red: dropping `visitCount` from cacheInput makes these equal.
    expect(eight).not.toEqual(thirty)
  })
})

describe('prompt-safety pins (Test #5, F14/F15)', () => {
  it('wraps memory + session content as untrusted, cleans the name, mutation-red on removal', async () => {
    mockDraftResolved()
    const { getCustomerMemory } = jest.requireMock('@/lib/karute/customer-memory')
    ;(getCustomerMemory as jest.Mock).mockResolvedValueOnce([
      { id: 'm1', category: 'body', label: 'INJECT-ME-MARKER', detail: null, source: 'staff', confidence: 1, pinned: false, suggestTalkingPoint: false, updatedAt: '' },
    ])
    await getReengagementDraft({
      ...BASE_PARAMS,
      status: 'dormant',
      lastVisitAgoDays: 120,
      customerName: '田中\n花子<script>',
    })
    const call = (openai.chat.completions.parse as jest.Mock).mock.calls[0][0]
    const systemContent = call.messages[0].content as string
    const userContent = call.messages[1].content as string
    // Mutation red: removing wrapUntrustedContent would drop these delimiters.
    expect(userContent).toContain('<<<UNTRUSTED:customer_memory>>>')
    expect(userContent).toContain('<<<END:customer_memory>>>')
    expect(userContent).toContain('<<<UNTRUSTED:recent_sessions>>>')
    expect(userContent).toContain('<<<END:recent_sessions>>>')
    expect(userContent).toContain('INJECT-ME-MARKER')
    // FIX ROUND 1 N2: the §1 prediction block gets the same defense-in-depth
    // wrap (mutation red on removal — see the dedicated test below for the
    // "present" case; this proves it fires even when absent).
    expect(userContent).toContain('<<<UNTRUSTED:body_prediction>>>')
    expect(userContent).toContain('<<<END:body_prediction>>>')
    // cleanNameToken strips control chars + angle brackets from the prompt anchor.
    expect(systemContent).not.toContain('<script>')
    expect(userContent).not.toContain('<script>')
    expect(systemContent).toContain('田中 花子')
  })

  it('FIX ROUND 1 N2: wraps a PRESENT §1 prediction block as untrusted too', async () => {
    mockDraftResolved()
    const { getBodyPrediction } = jest.requireMock('@/lib/karute/ai-body-prediction')
    ;(getBodyPrediction as jest.Mock).mockResolvedValueOnce({
      headline: 'INJECT-VIA-PREDICTION',
      confidence: 0.8,
      delta: 'stable',
      recommended: 'in 3 weeks',
    })
    await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    const userContent = (openai.chat.completions.parse as jest.Mock).mock.calls[0][0].messages[1].content as string
    expect(userContent).toContain('<<<UNTRUSTED:body_prediction>>>')
    expect(userContent).toContain('<<<END:body_prediction>>>')
    expect(userContent).toContain('INJECT-VIA-PREDICTION')
  })

  it('FIX ROUND 1 N3: overdue-tier prompt says "61〜89日"/"61-89 days" (the REENGAGE_NUDGE_MIN_DAYS gate), not the stale "46"', async () => {
    for (const locale of ['ja', 'en'] as const) {
      mockDraftResolved()
      await getReengagementDraft({ ...BASE_PARAMS, locale, status: 'needs-followup', lastVisitAgoDays: 61 })
      const calls = (openai.chat.completions.parse as jest.Mock).mock.calls
      const systemContent = calls[calls.length - 1][0].messages[0].content as string
      expect(systemContent).toContain(locale === 'ja' ? '61〜89日' : '61-89 days')
      expect(systemContent).not.toContain('46')
    }
  })

  it('REENGAGEMENT_PROMPT_VERSION (=1) is stamped in the cache key', async () => {
    mockDraftResolved()
    await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    const { getCachedAI } = jest.requireMock('@/lib/ai-cache')
    expect(getCachedAI.mock.calls[0][1].v).toBe(1)
  })

  it('static pin: the module does NOT import KARUTE_PROMPT_VERSION (a header comment explaining WHY is fine)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/karute/ai-reengagement.ts'), 'utf8')
    expect(src).not.toMatch(/import\s*\{[^}]*KARUTE_PROMPT_VERSION[^}]*\}\s*from/)
  })
})

describe('§1 pin (Test #6, F3)', () => {
  it('prediction present → its headline appears in the prompt payload', async () => {
    mockDraftResolved()
    const { getBodyPrediction } = jest.requireMock('@/lib/karute/ai-body-prediction')
    ;(getBodyPrediction as jest.Mock).mockResolvedValueOnce({
      headline: 'DISTINCTIVE-HEADLINE-MARKER',
      confidence: 70,
      delta: 'stable',
      recommended: '2週間後',
      recommendedSub: null,
      rationaleSummary: 'r',
    })
    await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    const call = (openai.chat.completions.parse as jest.Mock).mock.calls[0][0]
    expect(call.messages[1].content as string).toContain('DISTINCTIVE-HEADLINE-MARKER')
  })

  it('prediction absent → proceeds (draft still returned); payload notes absence', async () => {
    mockDraftResolved()
    const { getBodyPrediction } = jest.requireMock('@/lib/karute/ai-body-prediction')
    ;(getBodyPrediction as jest.Mock).mockResolvedValueOnce(null)
    const draft = await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    expect(draft).not.toBeNull()
    const call = (openai.chat.completions.parse as jest.Mock).mock.calls[0][0]
    expect(call.messages[1].content as string).toContain('(not available)')
  })

  it('§1 reuses the SAME 8-record fetch — no second/different karute read', async () => {
    mockDraftResolved()
    await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    const { getCustomerKaruteRecords } = jest.requireMock('@/actions/karute')
    const { getBodyPrediction } = jest.requireMock('@/lib/karute/ai-body-prediction')
    expect(getCustomerKaruteRecords).toHaveBeenCalledWith('cust-1', 8)
    expect(getBodyPrediction).toHaveBeenCalledTimes(1)
  })

  it('cache hit never calls §1 at all (deferred past the cache check)', async () => {
    const { getCachedAI } = jest.requireMock('@/lib/ai-cache')
    ;(getCachedAI as jest.Mock).mockResolvedValueOnce({ draft: 'cached', reasoning: 'r', signals: [], tier: 'dormant' })
    await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    const { getBodyPrediction } = jest.requireMock('@/lib/karute/ai-body-prediction')
    expect(getBodyPrediction).not.toHaveBeenCalled()
  })
})

describe('audit pin (Test #7, F9) — generation branch only, never cache hit or gated null', () => {
  it('web: generation emits ai.reengagement_draft with detail.customer_id', async () => {
    mockDraftResolved()
    await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    const { auditWeb } = jest.requireMock('@/lib/audit-web')
    expect(auditWeb).toHaveBeenCalledTimes(1)
    expect(auditWeb).toHaveBeenCalledWith({
      category: 'ai',
      action: 'ai.reengagement_draft',
      targetType: 'customer',
      targetId: 'cust-1',
      detail: { customer_id: 'cust-1' },
      requestId: expect.stringMatching(UUID_RE),
    })
  })

  it('web: cache hit emits NOTHING (red-run: no cache branch check)', async () => {
    const { getCachedAI } = jest.requireMock('@/lib/ai-cache')
    ;(getCachedAI as jest.Mock).mockResolvedValueOnce({ draft: 'cached', reasoning: 'r', signals: [], tier: 'dormant' })
    const draft = await getReengagementDraft({ ...BASE_PARAMS, status: 'dormant', lastVisitAgoDays: 120 })
    expect(draft?.draft).toBe('cached')
    expect(openai.chat.completions.parse).not.toHaveBeenCalled()
    const { auditWeb } = jest.requireMock('@/lib/audit-web')
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('web: gated null (on-track) emits NOTHING', async () => {
    await getReengagementDraft({ ...BASE_PARAMS, status: 'on-track', lastVisitAgoDays: 10 })
    const { auditWeb } = jest.requireMock('@/lib/audit-web')
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('facade: generation prints exactly one line, generation-only', async () => {
    mockDraftResolved()
    const lines = await auditLines(async () => {
      await getReengagementDraftWithClient({} as never, 'biz-1', 'staff-1', 'req-1', {
        ...BASE_PARAMS,
        status: 'dormant',
        lastVisitAgoDays: 120,
      })
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'ai',
      action: 'ai.reengagement_draft',
      actor_id: 'staff-1',
      actor_type: 'staff',
      business_id: 'biz-1',
      target_type: 'customer',
      target_id: 'cust-1',
      detail: { customer_id: 'cust-1' },
      request_id: 'req-1',
      source: 'facade',
    })
  })

  it('facade: cache hit prints zero lines', async () => {
    const { getCachedAI } = jest.requireMock('@/lib/ai-cache')
    ;(getCachedAI as jest.Mock).mockResolvedValueOnce({ draft: 'cached', reasoning: 'r', signals: [], tier: 'dormant' })
    const lines = await auditLines(async () => {
      await getReengagementDraftWithClient({} as never, 'biz-1', 'staff-1', 'req-1', {
        ...BASE_PARAMS,
        status: 'dormant',
        lastVisitAgoDays: 120,
      })
    })
    expect(lines).toHaveLength(0)
  })
})

describe('FIX ROUND 1 R4 — AUDITED_CORES registration is enforced directly', () => {
  // The verifier's V15 mutation (dropping the entire ai-reengagement.ts
  // AUDITED_CORES entry) left the full suite green: both generation-branch
  // helpers are module-PRIVATE, so CP7's registry-reality cross-check (which
  // enumerates exported symbols only) can never require this entry on its
  // own. This test closes that gap directly — red-run proof: delete the
  // entry (or either symbol) and this fails.
  it('pins the ai-reengagement.ts entry + both generation-branch helper symbols', async () => {
    const { AUDITED_CORES } = await import('@/lib/audit-policy')
    const entry = AUDITED_CORES.find((e) => e.file === 'src/lib/karute/ai-reengagement.ts')
    expect(entry).toBeDefined()
    expect(entry!.symbols).toEqual(
      expect.arrayContaining(['auditReengagementDraftGeneratedWeb', 'auditReengagementDraftGeneratedFacade']),
    )
  })
})
