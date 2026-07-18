// Voice enrollment ownership (packet 03, gap 2). The action trusted a
// caller-supplied staffId; a staffer may act only on their OWN voice, owner/
// manager (staff.manage) on anyone's. Proven: a foreign staffId without
// staff.manage is refused and NO write reaches the settings blob.
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'me'),
  resolveUserId: jest.fn(async () => 'me'),
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
import { auditLines } from './helpers/audit-lines'

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

describe('voice audit writers (wave A part 3)', () => {
  it('a successful enroll emits privacy.voice_enroll at notice targeting the staffer', async () => {
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(new Set())
    ;(createServiceClient as jest.Mock).mockReturnValue({
      storage: { from: () => ({ upload: jest.fn(async () => ({ error: null })) }) },
    })
    const lines = await auditLines(async () => {
      const res = await enrollVoiceAction('me', audioForm())
      expect(res.ok).toBe(true)
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'privacy',
      action: 'privacy.voice_enroll',
      severity: 'notice',
      actor_id: 'me',
      business_id: 'business-1',
      target_type: 'staff',
      target_id: 'me',
    })
  })

  it('a successful revoke emits privacy.voice_revoke; a refused one emits nothing', async () => {
    ;(getMyCapabilities as jest.Mock).mockResolvedValue(new Set())
    ;(createServiceClient as jest.Mock).mockReturnValue({
      storage: { from: () => ({ remove: jest.fn(async () => ({})) }) },
    })
    const { getOrgSettings } = await import('@/actions/org-settings')
    ;(getOrgSettings as jest.Mock).mockResolvedValue({
      voice_enrollments: { me: { sample_path: 'p', status: 'saved' } },
    })
    const ok = await auditLines(async () => {
      await expect(revokeVoiceAction('me')).resolves.toEqual({ ok: true })
    })
    expect(ok).toHaveLength(1)
    expect(ok[0]).toMatchObject({ action: 'privacy.voice_revoke', target_id: 'me' })

    const refused = await auditLines(async () => {
      await expect(revokeVoiceAction('someone-else')).resolves.toEqual({ ok: false })
    })
    expect(refused).toHaveLength(0)
  })
})
