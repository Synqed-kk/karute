/**
 * GlobalPipeline prompt-anchor context (AI-quality lane, PLAN-2026-07-15 B1).
 *
 * The first-pass pipeline previously called runAIPipeline without the 4th ctx
 * argument, so every initial extraction/summary ran with customerName=null and
 * sessionDate=null — the JA prompts lost their anchor line (このカルテのお客様／
 * セッション日) and relative dates (来月) had nothing to resolve against. Only
 * the AIで再生成 path supplied them. These tests pin the fix: a booking-carried
 * customer resolves to a name, the session date is the device-local day, and
 * walk-ins (no appointmentCustomerId) stay null rather than guessing.
 */
import type { PipelineResult, PipelineContext as AiCtx } from '@/lib/ai-pipeline'

// `mock`-prefixed so jest's hoisted factory may reference it.
const mockCalls: { ctx: AiCtx | undefined }[] = []

jest.mock('@/lib/ai-pipeline', () => ({
  runAIPipeline: jest.fn(
    (_blob: Blob, _locale: string, _onProgress: (s: string) => void, ctx?: AiCtx) => {
      mockCalls.push({ ctx })
      return new Promise<PipelineResult>(() => {
        // Never resolves — these tests only assert the call, not the lifecycle.
      })
    },
  ),
}))

import { globalPipeline } from '@/lib/global-pipeline'

const CUSTOMERS = [
  { id: 'c-1', name: '田中 花子' },
  { id: 'c-2', name: '鈴木 太郎' },
]

function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

beforeEach(() => {
  mockCalls.length = 0
  globalPipeline.reset()
})

describe('globalPipeline prompt-anchor ctx', () => {
  it('passes the booking customer name and the local session date', () => {
    globalPipeline.start(new Blob(['x']), {
      locale: 'ja',
      customers: CUSTOMERS,
      appointmentCustomerId: 'c-2',
    })
    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0].ctx).toEqual({
      customerName: '鈴木 太郎',
      sessionDate: localToday(),
    })
  })

  it('leaves customerName null for walk-ins (no booking customer)', () => {
    globalPipeline.start(new Blob(['x']), {
      locale: 'ja',
      customers: CUSTOMERS,
    })
    expect(mockCalls).toHaveLength(1)
    expect(mockCalls[0].ctx?.customerName).toBeNull()
    expect(mockCalls[0].ctx?.sessionDate).toBe(localToday())
  })

  it('leaves customerName null when the booking customer is not in the list', () => {
    globalPipeline.start(new Blob(['x']), {
      locale: 'ja',
      customers: CUSTOMERS,
      appointmentCustomerId: 'c-gone',
    })
    expect(mockCalls[0].ctx?.customerName).toBeNull()
  })
})
