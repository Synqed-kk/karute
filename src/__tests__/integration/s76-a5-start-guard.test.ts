/**
 * S76 commit W (A5) — the 録音履歴 save of a take this ERRORED run still holds
 * whole keeps the held blob AND its measured length; door OFF → start() swaps
 * exactly as today (K-6).
 */
import type { PipelineContext as AiCtx } from '@/lib/ai-pipeline'

const mockCalls: { blob: Blob; ctx: AiCtx | undefined }[] = []
jest.mock('@/lib/ai-pipeline', () => {
  class DamagedAudioError extends Error {}
  class EmptyTranscriptError extends Error {}
  return {
    DamagedAudioError,
    EmptyTranscriptError,
    runAIPipeline: jest.fn((blob: Blob, _t: string | null, _l: string, _p: unknown, ctx?: AiCtx) => {
      mockCalls.push({ blob, ctx })
      return mockCalls.length === 1 ? Promise.reject(new Error('network')) : new Promise(() => {})
    }),
  }
})

import { globalPipeline } from '@/lib/global-pipeline'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'

const whole = new Blob(['w'.repeat(20_030)])
const short = new Blob(['s'.repeat(27)])
const ctx = (over: Record<string, unknown>) => ({ locale: 'ja', customers: [], ...over })
const settle = async () => {
  for (let i = 0; i < 20 && globalPipeline.state !== 'error'; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  mockCalls.length = 0
  globalPipeline.reset()
  globalPipeline.start(whole, ctx({ takeId: 'T', duration: 1234 }))
  await settle()
  expect(globalPipeline.state).toBe('error')
})

describe('A5 — start() guard', () => {
  it('kept blob → the run gets the held blob and the HELD run’s duration (never the recovery window)', () => {
    globalPipeline.start(short, ctx({ takeId: 'T', duration: 42 }))
    expect(mockCalls[1].blob).toBe(whole)
    expect(mockCalls[1].ctx?.durationSeconds).toBe(1234)
  })
  it('another take → the new blob and its own duration', () => {
    globalPipeline.start(short, ctx({ takeId: 'U', duration: 42 }))
    expect(mockCalls[1].blob).toBe(short)
    expect(mockCalls[1].ctx?.durationSeconds).toBe(42)
  })
  it('door OFF → start() swaps as today', () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { stagedPartialDoor: boolean }, 'stagedPartialDoor', false)
    try {
      globalPipeline.start(short, ctx({ takeId: 'T', duration: 42 }))
      expect(mockCalls[1].blob).toBe(short)
      expect(mockCalls[1].ctx?.durationSeconds).toBe(42)
    } finally {
      off.restore()
    }
  })
})
