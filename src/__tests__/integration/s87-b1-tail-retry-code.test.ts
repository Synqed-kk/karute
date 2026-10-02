// model: claude-opus-5-5 · S87 fix round 2 (a) — B-1 (R-S87-15 a): the run's
// error for a failed tail upload is NOT a damaged-audio code, so the card keeps
// 再試行 (PipelineErrorCard hides it only for audio-unreadable / audio-partial).
import { pipelineErrorCode } from '@/lib/global-pipeline'
import { TailPendingError } from '@/lib/recording/secure-take'

describe('S87 B-1 — the tail failure is retryable', () => {
  it('pipelineErrorCode(TailPendingError) is a retryable code, never a damaged one', () => {
    const code = pipelineErrorCode(new TailPendingError())
    expect(code).not.toBe('audio-unreadable')
    expect(code).not.toBe('audio-partial')
    expect(code).not.toBe('discarded')
  })
})
