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
  // Real module spread so EmptyTranscriptError stays the REAL class — the
  // error-code mapping below is an instanceof check against it.
  ...jest.requireActual('@/lib/ai-pipeline'),
  runAIPipeline: jest.fn(
    (_blob: Blob, _locale: string, onProgress: (s: string) => void) =>
      new Promise<PipelineResult>((resolve, reject) => {
        mockDeferreds.push({ resolve, reject, onProgress })
      }),
  ),
}))

import { EmptyTranscriptError } from '@/lib/ai-pipeline'
import { globalPipeline } from '@/lib/global-pipeline'

const makeResult = (summary: string): PipelineResult => ({
  transcript: 't',
  entries: [],
  summary,
})

const ctx = { locale: 'en', customers: [] }
// Context that qualifies for B2 auto-save: a known customer + an outcome.
const ctxAuto = {
  locale: 'en',
  customers: [],
  appointmentCustomerId: 'c1',
  outcome: { status: 'success' as const },
}

// Drain microtasks so the awaited continuations inside run() execute.
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  globalPipeline.reset()
  mockDeferreds.length = 0
})

describe('globalPipeline run supersession', () => {
  // PR-B2 — the in-tab arm of the widened autosave cohort. The server route is
  // thin-only (web's staging key is not tenant-scoped), so on the web arm an
  // auto-finishing recovery take comes through run(), and this is the branch
  // that decides whether it lands or is handed back to a review screen nobody
  // asked for. It must land: recoveryUnanswered means the staff owes the take
  // nothing before it saves.
  it('an outcome-less RECOVERY take settles into autosaving, not review', async () => {
    globalPipeline.start(new Blob(['a']), {
      locale: 'en',
      customers: [],
      appointmentCustomerId: 'c1',
      recoveryUnanswered: true,
    })
    mockDeferreds[0].resolve(makeResult('A'))
    await flush()
    expect(globalPipeline.state).toBe('autosaving')
  })

  it('a take with NO answer and NO recovery flag still takes the review detour', async () => {
    globalPipeline.start(new Blob(['a']), {
      locale: 'en',
      customers: [],
      appointmentCustomerId: 'c1',
    })
    mockDeferreds[0].resolve(makeResult('A'))
    await flush()
    expect(globalPipeline.state).toBe('review')
  })

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

  it('surfaces an error from the live run as the generic code (never raw text)', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), ctx)
    mockDeferreds[0].reject(new Error('boom'))
    await flush()

    expect(globalPipeline.state).toBe('error')
    expect(globalPipeline.error).toBe('unknown')
    // The raw text still reaches the console for field debugging.
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('maps an empty transcript to its dedicated error code', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    globalPipeline.start(new Blob(['a']), ctx)
    mockDeferreds[0].reject(new EmptyTranscriptError())
    await flush()

    expect(globalPipeline.state).toBe('error')
    expect(globalPipeline.error).toBe('empty-transcript')
    consoleError.mockRestore()
  })
})

describe('globalPipeline B2 auto-save transition + runId guards', () => {
  it('enters autosaving when a known customer + outcome are present', async () => {
    globalPipeline.start(new Blob(['a']), ctxAuto)
    mockDeferreds[0].resolve(makeResult('A'))
    await flush()
    expect(globalPipeline.state).toBe('autosaving')
  })

  it('falls to review (not autosaving) without an outcome', async () => {
    globalPipeline.start(new Blob(['a']), { ...ctxAuto, outcome: undefined })
    mockDeferreds[0].resolve(makeResult('A'))
    await flush()
    expect(globalPipeline.state).toBe('review')
  })

  it('falls to review (not autosaving) for a walk-in (no known customer)', async () => {
    globalPipeline.start(new Blob(['a']), {
      ...ctxAuto,
      appointmentCustomerId: undefined,
    })
    mockDeferreds[0].resolve(makeResult('A'))
    await flush()
    expect(globalPipeline.state).toBe('review')
  })

  it('reset(staleRunId) is a no-op; reset(currentRunId) clears', async () => {
    globalPipeline.start(new Blob(['a']), ctxAuto)
    mockDeferreds[0].resolve(makeResult('A'))
    await flush()
    const runId = globalPipeline.runId

    globalPipeline.reset(runId - 1) // stale auto-save → must not clear
    expect(globalPipeline.state).toBe('autosaving')
    expect(globalPipeline.result?.summary).toBe('A')

    globalPipeline.reset(runId) // the owning run → clears
    expect(globalPipeline.state).toBe('idle')
    expect(globalPipeline.result).toBeNull()
  })

  it('failAutosaveToReview bails on a stale id, transitions on a matching id', async () => {
    globalPipeline.start(new Blob(['a']), ctxAuto)
    mockDeferreds[0].resolve(makeResult('A'))
    await flush()
    const runId = globalPipeline.runId

    globalPipeline.failAutosaveToReview(runId - 1) // stale → no-op
    expect(globalPipeline.state).toBe('autosaving')

    globalPipeline.failAutosaveToReview(runId) // matching → review
    expect(globalPipeline.state).toBe('review')
  })

  // Fix round 5: autosaveSettled is the C-1 gate's "this run's result is
  // already secured" input. Both places a run's result stops existing must
  // clear it, or the NEXT take inherits the last one's clearance and its own
  // unsettled window silently loses the confirm.
  it('start() and reset() clear autosaveSettled', async () => {
    globalPipeline.start(new Blob(['a']), ctxAuto)
    mockDeferreds[0].resolve(makeResult('A'))
    await flush()
    expect(globalPipeline.state).toBe('autosaving')

    // What ProcessingIndicator's effect does once the record is persisted.
    globalPipeline.autosaveSettled = true
    globalPipeline.start(new Blob(['b']), ctxAuto) // a new take supersedes
    expect(globalPipeline.autosaveSettled).toBe(false)

    globalPipeline.autosaveSettled = true
    globalPipeline.reset()
    expect(globalPipeline.autosaveSettled).toBe(false)
  })

  it('a late auto-save reset cannot clobber a NEWER take', async () => {
    globalPipeline.start(new Blob(['a']), ctxAuto) // take A
    mockDeferreds[0].resolve(makeResult('A'))
    await flush()
    const runA = globalPipeline.runId
    expect(globalPipeline.state).toBe('autosaving')

    globalPipeline.start(new Blob(['b']), ctxAuto) // take B supersedes
    expect(globalPipeline.runId).not.toBe(runA)

    globalPipeline.reset(runA) // A's stale auto-save resolves late
    expect(globalPipeline.state).toBe('processing') // B untouched
  })
})
