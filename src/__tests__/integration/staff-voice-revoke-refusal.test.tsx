/**
 * @jest-environment jsdom
 *
 * StaffList's voice-revoke handler MAPS the named refusal. revokeVoiceAction
 * returns { ok: false, reason: 'store_scope' } when the actor store clamp
 * refuses (src/actions/voice.ts); before this the handler discarded every
 * failure silently, so the chip simply stayed put with no explanation.
 * Companion: VoiceEnrollmentDialog's own mapping → voice-enrollment.test.tsx.
 * next-intl is mocked key-echo style (staff-limit-wall.test.tsx idiom).
 */
import { render, screen, fireEvent, act } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
  useLocale: () => 'ja',
}))

const toastError = jest.fn()
jest.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: jest.fn() } }))

// StaffList's action/dialog imports pull server-only chains — stub the
// boundaries; this test only exercises the revoke handler.
jest.mock('@/actions/staff', () => ({ deleteStaff: jest.fn(), uploadStaffAvatar: jest.fn() }))
const revokeVoiceAction = jest.fn(async () => ({ ok: false }) as { ok: boolean; reason?: string })
jest.mock('@/actions/voice', () => ({ revokeVoiceAction: () => revokeVoiceAction() }))
jest.mock('@/components/staff/StaffForm', () => ({ StaffForm: () => null }))
jest.mock('@/components/staff/PinSetup', () => ({ PinSetup: () => null }))
jest.mock('@/components/staff/VoiceEnrollmentDialog', () => ({ VoiceEnrollmentDialog: () => null }))
jest.mock('@/components/coaching/redesign/StaffConsentStatusBadge', () => ({
  StaffConsentStatusBadge: () => null,
}))

import { StaffList } from '@/components/staff/StaffList'

const ENROLLED = '2026-06-11T12:00:00Z'

function mountWithEnrolledVoice() {
  return render(
    <StaffList
      staffList={[{ id: 's0', full_name: 'スタッフ0', has_pin: true, created_at: '2026-01-01T00:00:00Z' }]}
      activeStaffId="s0"
      canManageStaff
      voiceEnrollments={{ s0: ENROLLED }}
    />,
  )
}

async function clickRevoke() {
  await act(async () => {
    fireEvent.click(screen.getByLabelText('voiceRevoke'))
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  revokeVoiceAction.mockResolvedValue({ ok: false })
})

describe('StaffList — voice revoke refusal', () => {
  it("a store-scope refusal toasts the clamp's own copy and keeps the chip", async () => {
    revokeVoiceAction.mockResolvedValue({ ok: false, reason: 'store_scope' })
    mountWithEnrolledVoice()
    await clickRevoke()
    expect(toastError).toHaveBeenCalledWith('staffStoreScopeDenied')
    expect(screen.getByLabelText('voiceRevoke')).toBeInTheDocument()
  })

  it('any other failure stays silent (unchanged) — chip kept, no toast', async () => {
    mountWithEnrolledVoice()
    await clickRevoke()
    expect(toastError).not.toHaveBeenCalled()
    expect(screen.getByLabelText('voiceRevoke')).toBeInTheDocument()
  })

  it('success clears the chip and toasts nothing', async () => {
    revokeVoiceAction.mockResolvedValue({ ok: true })
    mountWithEnrolledVoice()
    await clickRevoke()
    expect(toastError).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('voiceRevoke')).toBeNull()
  })
})
