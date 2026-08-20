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
const deleteTake = jest.fn()
jest.mock('@/lib/karute/take-store', () => ({
  deleteTake: (...a: unknown[]) => deleteTake(...a),
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
