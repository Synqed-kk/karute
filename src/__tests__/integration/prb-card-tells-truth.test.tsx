/**
 * @jest-environment jsdom
 *
 * PR-B commit 3 — the card tells the truth (B2, B-S66-8, cut #3, B11/F12d).
 * The ONE mapping table (global-pipeline pipelineErrorCode), the two
 * damaged-audio codes on the card with NO 再試行 and a labelled reference
 * number, the in-tab read of a take finalize already refused, and the OFF
 * state = today's card.
 */
import { render, screen } from '@testing-library/react'
import { PipelineErrorCard } from '@/components/karute/redesign/record/PipelineErrorCard'
import { pipelineErrorCode } from '@/lib/global-pipeline'
import { DamagedAudioError, EmptyTranscriptError, runAIPipeline } from '@/lib/ai-pipeline'
import { StagedDoorError, blobFate } from '@/lib/recording/blob-fate'
import { RECORDING_SWITCHES } from '@/lib/recording/recording-switches'
import { isDamagedTake, takeReference } from '@/lib/karute/take-store'
import { CONSENT_REQUIRED_ERROR } from '@/lib/consent'
import { AUDIO_UNREADABLE, DISCARDED_BY_STAFF } from '@/lib/recording/job-errors'

// Real ja.json through a mocked hook (the pipeline-error-card suite's pattern).
jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, values?: Record<string, string>) => {
    const messages = jest.requireActual<Record<string, Record<string, string>>>('../../../messages/ja.json')
    const text = messages[ns]?.[key] ?? key
    return values ? text.replace(/\{(\w+)\}/g, (_m, k: string) => values[k] ?? '') : text
  },
}))

const secure = { meta: null as Record<string, unknown> | null }
jest.mock('@/lib/karute/take-store', () => ({
  ...jest.requireActual('@/lib/karute/take-store'),
  readTakeSecureMeta: async () => (secure.meta ? { ...secure.meta } : null),
  ensureFinalizedPath: async () => null,
}))
jest.mock('@/lib/recording/secure-take', () => ({ ensureAudioOnServer: async () => null }))
jest.mock('@/lib/global-recorder', () => ({ globalRecorder: { awaitTakeSecured: async () => {} } }))
const prepareTranscription = jest.fn(async () => {
  throw new Error('the fallback door was called')
})
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: () => ({ aiBase: '/api/ai', prepareTranscription }),
}))

const ja = jest.requireActual<Record<string, Record<string, string>>>('../../../messages/ja.json')
const noop = () => {}
const TAKE = '3f9a1c2e-5b4d-4e6f-8a7b-1c2d3e4f5a6b'
const SESSION = '6d2e1f0a-3b4c-4d5e-9f8a-7b6c5d4e3f2a'

describe('the ONE mapping table (cut #3)', () => {
  it('maps every server sentinel and typed error to its card code', () => {
    expect(pipelineErrorCode(CONSENT_REQUIRED_ERROR)).toBe('consent-required')
    expect(pipelineErrorCode('EMPTY_TRANSCRIPT')).toBe('empty-transcript')
    expect(pipelineErrorCode(DISCARDED_BY_STAFF)).toBe('discarded')
    expect(pipelineErrorCode(AUDIO_UNREADABLE)).toBe('audio-unreadable')
    expect(pipelineErrorCode('unreadable_object')).toBe('audio-unreadable')
    expect(pipelineErrorCode('audio_partial')).toBe('audio-partial')
    expect(pipelineErrorCode(new EmptyTranscriptError())).toBe('empty-transcript')
    expect(pipelineErrorCode(new DamagedAudioError('unreadable'))).toBe('audio-unreadable')
    expect(pipelineErrorCode(new DamagedAudioError('partial'))).toBe('audio-partial')
  })
  it('a staged-door throw (typed or the literal mismatch) is never a terminal word (D-4)', () => {
    expect(pipelineErrorCode(new Error('staged copy mismatch'))).toBe('unknown')
    expect(pipelineErrorCode(new StagedDoorError('upstream', 502, 'x'))).toBe('unknown')
    expect(pipelineErrorCode('boom')).toBe('unknown')
    expect(pipelineErrorCode(null)).toBe('unknown')
    expect(pipelineErrorCode('__proto__')).toBe('unknown')
  })
})

describe('the card tells the truth', () => {
  it.each([
    ['audio-unreadable', 'pipelineErrorAudioUnreadable'],
    ['audio-partial', 'pipelineErrorAudioPartial'],
  ] as const)('%s → its own sentence, a labelled reference number, and NO 再試行', (code, key) => {
    render(<PipelineErrorCard code={code} reference="3f9a1c2e" onCancel={noop} onRetry={noop} />)
    expect(screen.getByText(ja.recording[key])).toBeTruthy()
    expect(screen.getByText(ja.recording.pipelineErrorReference.replace('{reference}', '3f9a1c2e'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: ja.common.retry })).toBeNull()
    expect(screen.getByRole('button', { name: ja.common.cancel })).toBeTruthy()
  })
  it('the reference line shows on the damaged codes only', () => {
    render(<PipelineErrorCard code="unknown" reference="3f9a1c2e" onCancel={noop} onRetry={noop} />)
    expect(screen.queryByText(/3f9a1c2e/)).toBeNull()
    expect(screen.getByRole('button', { name: ja.common.retry })).toBeTruthy()
  })
})

describe('takeReference — ONE home (B11/F12d)', () => {
  it('the take uuid first, else the session id, else null', () => {
    expect(takeReference({ takeId: TAKE, recordingSessionId: SESSION })).toBe('3f9a1c2e')
    expect(takeReference({ takeId: 'take-legacy-1', recordingSessionId: SESSION })).toBe('6d2e1f0a')
    expect(takeReference({ takeId: 'take-legacy-1', recordingSessionId: null })).toBeNull()
    expect(takeReference({})).toBeNull()
  })
})

describe('the in-tab run learns a damaged take before any fallback (B2)', () => {
  afterEach(() => {
    secure.meta = null
    prepareTranscription.mockClear()
  })
  it.each([
    ['unreadable_object', 'unreadable'],
    ['audio_unreadable', 'unreadable'],
    ['audio_partial', 'partial'],
  ])('secureError %s → DamagedAudioError(%s), the fallback door never called', async (code, kind) => {
    secure.meta = { recordingSessionId: SESSION, secureError: code, startedAt: 1, updatedAt: 1 }
    const run = runAIPipeline(new Blob(['x'.repeat(40)], { type: 'audio/webm' }), TAKE, 'ja', noop)
    await expect(run).rejects.toBeInstanceOf(DamagedAudioError)
    await expect(run).rejects.toMatchObject({ kind })
    expect(prepareTranscription).not.toHaveBeenCalled()
  })
})

describe('switch OFF = today\'s card (D-7)', () => {
  it('a damaged take with stagedPartialDoor OFF → no typed error, today\'s generic words, 再試行 kept', async () => {
    const off = jest.replaceProperty(RECORDING_SWITCHES as { stagedPartialDoor: boolean }, 'stagedPartialDoor', false)
    try {
      expect(isDamagedTake({ secureError: 'unreadable_object' })).toBe(false)
      expect(await blobFate(new Blob(['x'.repeat(40)]))).toBe('ok')
      secure.meta = { recordingSessionId: SESSION, secureError: 'unreadable_object', startedAt: 1, updatedAt: 1 }
      let thrown: unknown = null
      await runAIPipeline(new Blob(['x'.repeat(40)], { type: 'audio/webm' }), TAKE, 'ja', noop).catch((e) => {
        thrown = e
      })
      expect(thrown).not.toBeInstanceOf(DamagedAudioError)
      expect(prepareTranscription).toHaveBeenCalled() // today's fallback door
      const code = pipelineErrorCode(thrown)
      expect(code).toBe('unknown')
      render(<PipelineErrorCard code={code} reference="3f9a1c2e" onCancel={noop} onRetry={noop} />)
      expect(screen.getByText(ja.recording.pipelineErrorGeneric)).toBeTruthy()
      expect(screen.getByRole('button', { name: ja.common.retry })).toBeTruthy()
      expect(screen.queryByText(/3f9a1c2e/)).toBeNull()
    } finally {
      off.restore()
      secure.meta = null
      prepareTranscription.mockClear()
    }
  })
})
