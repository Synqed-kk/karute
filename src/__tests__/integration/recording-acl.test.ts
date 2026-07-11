/**
 * Coverage for canViewTranscript (src/lib/auth/recording-acl.ts) — the per-staff
 * recording-privacy boundary (#4). The raw transcript is private to the staff who
 * recorded it; the AI summary stays shared (not modeled here — it's never gated).
 */
import { canViewTranscript } from '@/lib/auth/recording-acl'

describe('canViewTranscript', () => {
  it('the recording staff sees their own transcript', () => {
    expect(
      canViewTranscript({ ownerStaffId: 's1', viewerStaffId: 's1', canViewAll: false }),
    ).toBe(true)
  })

  it('a different staff is denied (the core privacy rule)', () => {
    expect(
      canViewTranscript({ ownerStaffId: 's1', viewerStaffId: 's2', canViewAll: false }),
    ).toBe(false)
  })

  it('a recordings.viewAll role (owner/manager) sees everyone’s', () => {
    expect(
      canViewTranscript({ ownerStaffId: 's1', viewerStaffId: 's2', canViewAll: true }),
    ).toBe(true)
  })

  it('an ownerless record (legacy/manual) is shared', () => {
    expect(
      canViewTranscript({ ownerStaffId: null, viewerStaffId: 's2', canViewAll: false }),
    ).toBe(true)
  })

  it('a viewer with no staff identity is denied an owned transcript', () => {
    expect(
      canViewTranscript({ ownerStaffId: 's1', viewerStaffId: null, canViewAll: false }),
    ).toBe(false)
  })
})
