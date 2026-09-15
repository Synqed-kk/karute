/**
 * `recorderIsLive()` — the guard's own body (L2 fresh N1).
 *
 * ⚠ WHY THIS FILE EXISTS. Fix round 2 added this function *specifically* to
 * stop the stale-snapshot race that let a finished take play into a live
 * microphone: the component must ask the SINGLETON immediately before every
 * `play()`, never a render snapshot. The component's USE of it is pinned six
 * ways in recording-player-card.test.tsx — but every one of those suites MOCKS
 * this module and substitutes its own implementation, so the real body was
 * never executed by anything. L2 neutered it to `return false` and the full
 * suite stayed green at 9,742 passed with a clean type-check: the same bug that
 * had just been fixed, one layer down.
 *
 * Node env on purpose (no jsdom needed — `state` is a plain public field on the
 * singleton), and the two seam mocks are the repo's own: the hook reaches
 * global-recorder → actions/recordings → the ESM-only SDK and next/cache, which
 * jest cannot parse. Neither is touched by the assertions below.
 */
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {},
  SynqedError: class extends Error {},
}))
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))

import { recorderIsLive } from '@/hooks/use-global-recorder'
import { globalRecorder } from '@/lib/global-recorder'

const previous = globalRecorder.state
afterAll(() => {
  globalRecorder.state = previous
})

describe('recorderIsLive — the live read the play guard depends on', () => {
  // 'paused' counts: the session is not over, the mic is still held, and a take
  // must not play over it.
  it.each([
    ['recording', true],
    ['paused', true],
    ['idle', false],
    // 'recorded' = stopped, take in hand. Nothing is live, so playback is fine.
    ['recorded', false],
  ] as const)('state %s → %s', (state, expected) => {
    globalRecorder.state = state
    expect(recorderIsLive()).toBe(expected)
  })

  it('reads the singleton at CALL time, not at import time', () => {
    globalRecorder.state = 'idle'
    expect(recorderIsLive()).toBe(false)
    // The whole point: the answer changes without anything re-rendering or
    // re-importing, which is what the mint's await window needs.
    globalRecorder.state = 'recording'
    expect(recorderIsLive()).toBe(true)
  })
})
