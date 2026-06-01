/**
 * GlobalPipeline run-supersession (PR #127 review follow-up).
 *
 * The background pipeline now lets staff start a second recording while a
 * previous take is still transcribing. Without a guard, the first run could
 * resolve LATE and clobber the second run's state (or revive the chip after a
 * discard/reset). run() is tagged with a runId; a superseded or reset run must
 * bail on resolve instead of writing stale state. These tests pin that down.
 */
import type { PipelineResult } from '@/lib/ai-pipeline'

type Deferred = {
  resolve: (r: PipelineResult) => void
  reject: (e: unknown) => void
  onProgress: (step: string) => void
}

// `mock`-prefixed so jest's hoisted factory may reference it.
const mockDeferreds: Deferred[] = []

jest.mock('@/lib/ai-pipeline', () => ({
  runAIPipeline: jest.fn(
    (_blob: Blob, _locale: string, onProgress: (s: string) => void) =>
      new Promise<PipelineResult>((resolve, reject) => {
        mockDeferreds.push({ resolve, reject, onProgress })
      }),
  ),
}))

import { globalPipeline } from '@/lib/global-pipeline'

const makeResult = (summary: string): PipelineResult => ({
  transcript: 't',
  entries: [],
  summary,
})

const ctx = { locale: 'en', customers: [] }

// Drain microtasks so the awaited continuations inside run() execute.
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  globalPipeline.reset()
  mockDeferreds.length = 0
})

describe('globalPipeline run supersession', () => {
  it('completes a single run into the review state', async () => {
    globalPipeline.start(new Blob(['a']), ctx)
    expect(globalPipeline.state).toBe('processing')

    mockDeferreds[0].resolve(makeResult('A'))
    await flush()

    expect(globalPipeline.state).toBe('review')
    expect(globalPipeline.result?.summary).toBe('A')
  })

  it('does not let a superseded run clobber the newer one', async () => {
    globalPipeline.start(new Blob(['a']), ctx) // run #1
    globalPipeline.start(new Blob(['b']), ctx) // run #2 supersedes #1
    expect(mockDeferreds).toHaveLength(2)

    // Newer run finishes first, then the stale one resolves late.
    mockDeferreds[1].resolve(makeResult('B'))
    await flush()
    mockDeferreds[0].resolve(makeResult('A'))
    await flush()

    expect(globalPipeline.state).toBe('review')
    expect(globalPipeline.result?.summary).toBe('B') // not clobbered by 'A'
  })

  it('ignores a run that resolves after reset()', async () => {
    globalPipeline.start(new Blob(['a']), ctx)
    globalPipeline.reset()
    expect(globalPipeline.state).toBe('idle')

    mockDeferreds[0].resolve(makeResult('A'))
    await flush()

    expect(globalPipeline.state).toBe('idle') // chip not revived
    expect(globalPipeline.result).toBeNull()
  })

  it('ignores a stale onProgress step from a superseded run', async () => {
    globalPipeline.start(new Blob(['a']), ctx) // run #1
    globalPipeline.start(new Blob(['b']), ctx) // run #2

    mockDeferreds[1].onProgress('summarizing') // live run advances
    mockDeferreds[0].onProgress('extracting') // stale run — must be ignored

    expect(globalPipeline.step).toBe('summarizing')
  })

  it('surfaces an error from the live run', async () => {
    globalPipeline.start(new Blob(['a']), ctx)
    mockDeferreds[0].reject(new Error('boom'))
    await flush()

    expect(globalPipeline.state).toBe('error')
    expect(globalPipeline.error).toBe('boom')
  })
})
