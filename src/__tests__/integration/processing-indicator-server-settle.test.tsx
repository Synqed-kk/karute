/**
 * @jest-environment jsdom
 *
 * ProcessingIndicator's server-path settle branch (packet 22 B3): when
 * globalPipeline.serverSavedRecordId is set (runServerJob's DONE branch —
 * see global-pipeline-server-job.test.ts), the autosave effect must skip
 * saveKaruteRecordInline entirely and fire the SAME toast/hold/reset the
 * in-tab autosave produces — reusing that settle verbatim rather than
 * inventing new UI (the packet's explicit "mirror it" instruction).
 */
import { act, render, screen, waitFor } from '@testing-library/react'

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
const saveKaruteRecordInline = jest.fn(async (_input?: unknown) => ({ id: 'should-not-be-called' }))
jest.mock('@/actions/karute', () => ({
  saveKaruteRecordInline: (...a: unknown[]) => saveKaruteRecordInline(...a),
}))
jest.mock('@/lib/karute/take-store', () => ({ deleteTake: jest.fn() }))

import { toast } from 'sonner'
import { ProcessingIndicator } from '@/components/recording/ProcessingIndicator'
import { globalPipeline } from '@/lib/global-pipeline'

beforeEach(() => {
  globalPipeline.reset()
  saveKaruteRecordInline.mockClear()
  ;(toast.success as jest.Mock).mockClear()
})

describe('ProcessingIndicator server-path settle (packet 22 B3)', () => {
  it('serverSavedRecordId set → toasts + resets WITHOUT calling saveKaruteRecordInline', async () => {
    // Simulate what runServerJob's DONE branch does: set the id, flip to
    // 'autosaving' (the same state the in-tab autosave uses).
    act(() => {
      globalPipeline.start(new Blob(['a']), { locale: 'ja', customers: [] })
    })
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalPipeline as any).serverSavedRecordId = 'record-1'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalPipeline as any).state = 'autosaving'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalPipeline as any).notify()
    })

    render(<ProcessingIndicator />)

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    expect(saveKaruteRecordInline).not.toHaveBeenCalled()
    // Fix round 5: the record exists server-side, so this branch is a secure
    // point too — the C-1 supersession gate must stop asking about this run.
    expect(globalPipeline.autosaveSettled).toBe(true)

    // The held 保存済み chip renders (same as the in-tab success path).
    expect(screen.getByText('保存済み — カルテ作成完了')).toBeTruthy()
    // PR-B2: the landed record is published so the recovery notice can name it.
    expect(globalPipeline.savedRecordId).toBe('record-1')
  })

  // PR-B2 — the in-tab (web/desktop) arm of the widened cohort. This effect's
  // own guard has to recognise recoveryUnanswered too, or an auto-finishing
  // recovery take would enter 'autosaving' and be bounced straight back to
  // review — the exact detour PR-B1 removed for answered takes.
  it('an outcome-less RECOVERY take still autosaves in-tab, and publishes its record', async () => {
    saveKaruteRecordInline.mockResolvedValueOnce({ id: 'record-9' })
    act(() => {
      globalPipeline.start(new Blob(['a']), {
        locale: 'ja',
        customers: [],
        appointmentCustomerId: 'cust-1',
        recoveryUnanswered: true,
        takeId: 'take-1',
      })
    })
    act(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalPipeline as any).result = { transcript: 't', summary: 'S', entries: [] }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalPipeline as any).state = 'autosaving'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalPipeline as any).notify()
    })

    render(<ProcessingIndicator />)

    await waitFor(() => expect(saveKaruteRecordInline).toHaveBeenCalledTimes(1))
    // R-B2: no outcome was invented on the way to the writer.
    expect((saveKaruteRecordInline.mock.calls[0][0] as { outcome?: unknown }).outcome)
      .toBeUndefined()
    await waitFor(() => expect(globalPipeline.savedRecordId).toBe('record-9'))
    // NOT bounced to review — the take is landed, not handed back.
    expect(globalPipeline.state).not.toBe('review')
  })
})
