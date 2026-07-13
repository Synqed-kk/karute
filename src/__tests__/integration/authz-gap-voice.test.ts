// Voice enrollment ownership (packet 03, gap 2). The action trusted a
// caller-supplied staffId; a staffer may act only on their OWN voice, owner/
// manager (staff.manage) on anyone's. Proven: a foreign staffId without
// staff.manage is refused and NO write reaches the settings blob.
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'me'),
}))
jest.mock('@/lib/auth/require-permission', () => ({ getMyCapabilities: jest.fn() }))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ voice_enrollments: {} })),
  writeOrgSettingsBlob: jest.fn(async () => ({ success: true })),
}))

import { enrollVoiceAction, revokeVoiceAction } from '@/actions/voice'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { writeOrgSettingsBlob } from '@/actions/org-settings'
import { createServiceClient } from '@/lib/supabase/service'

function audioForm() {
  const fd = new FormData()
  fd.set('audio', new File([new Uint8Array(1024)], 'a.webm', { type: 'audio/webm' }))
  return fd
}

beforeEach(() => jest.clearAllMocks())

describe('voice enrollment ownership', () => {
  it('refuses enrolling ANOTHER staffer without staff.manage — no write, no upload', async () => {
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(new Set()) // practitioner
    const res = await enrollVoiceAction('someone-else', audioForm())
    expect(res.ok).toBe(false)
    expect(writeOrgSettingsBlob).not.toHaveBeenCalled()
    expect(createServiceClient).not.toHaveBeenCalled() // never reached the storage upload
  })

  it('refuses revoking ANOTHER staffer without staff.manage', async () => {
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(new Set())
    const res = await revokeVoiceAction('someone-else')
    expect(res.ok).toBe(false)
    expect(writeOrgSettingsBlob).not.toHaveBeenCalled()
  })

  it('allows a manager (staff.manage) to revoke another staffer', async () => {
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(new Set(['staff.manage']))
    ;(createServiceClient as jest.Mock).mockReturnValue({
      storage: { from: () => ({ remove: jest.fn(async () => ({})) }) },
    })
    const { getOrgSettings } = await import('@/actions/org-settings')
    ;(getOrgSettings as jest.Mock).mockResolvedValue({
      voice_enrollments: { 'someone-else': { sample_path: 'p', status: 'saved' } },
    })
    const res = await revokeVoiceAction('someone-else')
    expect(res.ok).toBe(true)
    expect(writeOrgSettingsBlob).toHaveBeenCalled()
  })
})
