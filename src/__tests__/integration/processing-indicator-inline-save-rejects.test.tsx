/**
 * @jest-environment jsdom
 *
 * Greptile #729 — the in-tab autosave's REJECTION path.
 *
 * `saveKaruteRecordInline` does not only return `{ error }`: it throws
 * CONSENT_REQUIRED_ERROR outright, and any transport failure rejects. The
 * autosave IIFE in ProcessingIndicator handled the error-SHAPED return and
 * nothing else, so a rejection left the pipeline wedged in 'autosaving' with no
 * toast, no review fallback, and a spinner that never settled.
 *
 * PR-B2 is why that stopped being cosmetic: an outcome-less RECOVERY take
 * reaches this path AFTER setRecoveredTake(null) has cleared its offer, so a
 * wedge left that cohort with no banner, no notice and no toast at all. The
 * audio is deleted only on success, so a relaunch still self-heals — what was
 * lost was the telling, not the recording.
 *
 * Its OWN file on purpose: processing-indicator-server-settle.test.tsx shares
 * one module-level singleton across five renders, and its leftover
 * savedRecordId/late timers reach into whatever runs after them. A fresh module
 * registry is the cheapest way for this pin to mean only what it says.
 */
import { act, render, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => {
    const messages = jest.requireActual<Record<string, Record<string, string>>>(
      '../../../messages/ja.json',
    )
    return messages[ns]?.[key] ?? key
  },
}))
jest.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...(props as object)}>{children}</a>
  ),
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
const saveKaruteRecordInline = jest.fn(async (_input?: unknown) => ({ id: 'r' }))
jest.mock('@/actions/karute', () => ({
  saveKaruteRecordInline: (...a: unknown[]) => saveKaruteRecordInline(...a),
}))
/** Takes the SERVER NEVER RECEIVED under a finalized key — the cohort
 *  deleteTake refuses to destroy automatically (capture pipeline PR4). */
const strandedTakeIds = new Set<string>()
/** …and what the store would have left behind afterwards. */
const deletedTakeIds = new Set<string>()
/** ⚖ IT CARRIES THE REAL GUARD (fix round 3). A fake that removed
 *  unconditionally would go green on a call site that never got past the
 *  guard at all — which is exactly the bug this round closes for the in-tab
 *  autosave's settle. */
const deleteTake = jest.fn(async (takeId: string, opts?: { humanResolved?: boolean }) => {
  if (strandedTakeIds.has(takeId) && !opts?.humanResolved) return
  deletedTakeIds.add(takeId)
})
jest.mock('@/lib/karute/take-store', () => ({
  deleteTake: (...a: unknown[]) => deleteTake(...(a as [string, { humanResolved?: boolean }?])),
}))

import { toast } from 'sonner'
import { ProcessingIndicator } from '@/components/recording/ProcessingIndicator'
import { globalPipeline } from '@/lib/global-pipeline'

/** Stage the singleton the way the in-tab pipeline leaves it at settle time.
 *  Deliberately NOT via start(): start() would also kick the real
 *  runAIPipeline, whose fetch rejects a second later and clobbers the state
 *  this test is waiting on. */
function stageInTabAutosave() {
  act(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    ;(globalPipeline as any).context = {
      locale: 'ja',
      customers: [],
      appointmentCustomerId: 'cust-1',
      // The PR-B2 cohort: no outcome, no skip, and its offer already cleared.
      recoveryUnanswered: true,
      autoFinish: true,
      takeId: 'take-1',
    }
    ;(globalPipeline as any).result = { transcript: 't', summary: 'S', entries: [] }
    ;(globalPipeline as any).state = 'autosaving'
    ;(globalPipeline as any).notify()
    /* eslint-enable @typescript-eslint/no-explicit-any */
  })
}

beforeEach(() => {
  globalPipeline.reset()
  jest.clearAllMocks()
  strandedTakeIds.clear()
  deletedTakeIds.clear()
})

describe('ProcessingIndicator — a REJECTED inline save (Greptile #729)', () => {
  it('falls back to review and SAYS so — never a silent wedge', async () => {
    saveKaruteRecordInline.mockRejectedValueOnce(new Error('network'))
    stageInTabAutosave()

    render(<ProcessingIndicator />)

    await waitFor(() => expect(saveKaruteRecordInline).toHaveBeenCalledTimes(1))
    // Not wedged in 'autosaving' — the take goes back to the staff.
    await waitFor(() => expect(globalPipeline.state).toBe('review'))
    // And not silent: the auto-finish marker suppresses the SUCCESS toast only,
    // never a failure the staff has to act on.
    expect(toast.error).toHaveBeenCalledWith(
      '自動保存に失敗しました。確認画面から保存してください。',
    )
    // Nothing saved ⇒ the audio must still be there for the retry, and no
    // record id may be published for a save that never landed.
    expect(deleteTake).not.toHaveBeenCalled()
    expect(globalPipeline.savedRecordId).toBeNull()
    expect(globalPipeline.autosaveSettled).toBe(false)
  })

  it('an error-SHAPED return is still handled identically (the arm that already worked)', async () => {
    saveKaruteRecordInline.mockResolvedValueOnce({ error: 'boom' } as never)
    stageInTabAutosave()

    render(<ProcessingIndicator />)

    await waitFor(() => expect(globalPipeline.state).toBe('review'))
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(deleteTake).not.toHaveBeenCalled()
  })
})

// ── ⚖ THE SETTLE ARM (capture pipeline PR4 fix round 3, F1) ────────────────
// Same staged autosave, the other exit. A stranded or expired take is offered
// as `kind: 'take'` and settles HERE, after the in-tab pipeline transcribed it
// and this save wrote the karute — so the server holds this audio, under the
// take's finalized key or as the staged copy the words came from. Unflagged,
// the never-delete guard refused it: the record was written, the take survived,
// the 復元可能 row came back on the next fold and each retap filed ANOTHER
// karute. It lives in this file rather than the server-settle suite because
// that one shares a singleton across five renders; this one's registry is
// fresh, so the pin means only what it says.
describe('ProcessingIndicator — a take the server never finalized is settled by the save', () => {
  it('the take rows are gone: the 復元可能 row cannot come back', async () => {
    strandedTakeIds.add('take-1')
    stageInTabAutosave()

    render(<ProcessingIndicator />)

    await waitFor(() => expect(saveKaruteRecordInline).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(deleteTake).toHaveBeenCalled())
    // THE OUTCOME FIRST: the rows are actually gone, judged through the real
    // guard — not the argument that got them past it.
    expect(deletedTakeIds.has('take-1')).toBe(true)
    expect(deleteTake).toHaveBeenCalledWith('take-1', { humanResolved: true })
  })

  it('an ordinary finalized take is settled exactly as before', async () => {
    stageInTabAutosave()

    render(<ProcessingIndicator />)

    await waitFor(() => expect(deleteTake).toHaveBeenCalled())
    expect(deletedTakeIds.has('take-1')).toBe(true)
  })
})
