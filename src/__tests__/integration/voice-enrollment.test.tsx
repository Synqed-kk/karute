/**
 * @jest-environment jsdom
 *
 * REAL voice enrollment (was a stub: fake timer, audio discarded). Locks the
 * contract: consent gate → actual MediaRecorder capture → upload via
 * enrollVoiceAction → server timestamp; mic-denied and upload-failure paths.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[part]
      if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return cur.replace(/\{(\w+)\}/g, (_, v: string) => String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`))
    },
  }
})
jest.mock('@/actions/voice', () => ({
  enrollVoiceAction: jest.fn().mockResolvedValue({ ok: true, enrolledAt: '2026-06-11T12:00:00Z' }),
  revokeVoiceAction: jest.fn().mockResolvedValue({ ok: true }),
}))
const actions = jest.requireMock('@/actions/voice') as Record<string, jest.Mock>

import { VoiceEnrollmentDialog } from '@/components/staff/VoiceEnrollmentDialog'

const ja = jest.requireActual('../../../messages/ja.json').voiceEnrollment

class FakeRecorder {
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  mimeType = 'audio/webm'
  start() {
    this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) })
  }
  stop() {
    this.onstop?.()
  }
}
const trackStop = jest.fn()
beforeEach(() => {
  jest.clearAllMocks()
  ;(global as Record<string, unknown>).MediaRecorder = FakeRecorder
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }),
    },
  })
})

const mount = () =>
  render(
    <VoiceEnrollmentDialog open staffId="s-1" staffName="原田 かなみ" onClose={() => {}} />,
  )

async function getToRecordingStep() {
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByText(ja.proceed))
}

describe('voice enrollment — real wiring', () => {
  it('consent gates the flow: proceed disabled until the box is checked', () => {
    mount()
    expect(screen.getByText(ja.proceed).closest('button')).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText(ja.proceed).closest('button')).toBeEnabled()
  })

  it('record → stop → uploads the captured blob and shows the server-confirmed completion', async () => {
    mount()
    await getToRecordingStep()
    await act(async () => {
      fireEvent.click(screen.getByLabelText(ja.startRecord))
    })
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: { noiseSuppression: true, echoCancellation: true },
    })
    await act(async () => {
      fireEvent.click(screen.getByLabelText(ja.stopRecord))
    })
    expect(actions.enrollVoiceAction).toHaveBeenCalledTimes(1)
    const [staffId, fd] = actions.enrollVoiceAction.mock.calls[0]
    expect(staffId).toBe('s-1')
    expect((fd as FormData).get('audio')).toBeInstanceOf(File)
    expect(trackStop).toHaveBeenCalled() // mic released
    expect(await screen.findByText(ja.completeTitle)).toBeInTheDocument()
  })

  it('mic permission denied → clear error, no upload', async () => {
    ;(navigator.mediaDevices.getUserMedia as jest.Mock).mockRejectedValue(new Error('denied'))
    mount()
    await getToRecordingStep()
    await act(async () => {
      fireEvent.click(screen.getByLabelText(ja.startRecord))
    })
    expect(await screen.findByText(ja.micDenied)).toBeInTheDocument()
    expect(actions.enrollVoiceAction).not.toHaveBeenCalled()
  })

  it('upload failure → error + back to the recording step (retryable)', async () => {
    actions.enrollVoiceAction.mockResolvedValueOnce({ ok: false })
    mount()
    await getToRecordingStep()
    await act(async () => {
      fireEvent.click(screen.getByLabelText(ja.startRecord))
    })
    await act(async () => {
      fireEvent.click(screen.getByLabelText(ja.stopRecord))
    })
    expect(await screen.findByText(ja.uploadFailed)).toBeInTheDocument()
    expect(screen.queryByText(ja.completeTitle)).toBeNull()
  })
})
