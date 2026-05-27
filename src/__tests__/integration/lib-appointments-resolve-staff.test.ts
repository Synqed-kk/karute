/**
 * Unit coverage for resolveStaffProfileId (PR #89/#105, replay/15) — the
 * staffProfileId/staffId alias resolver used during the column rename.
 */
import { resolveStaffProfileId, type AppointmentInput } from '@/lib/appointments'

function input(over: Partial<AppointmentInput>): AppointmentInput {
  return { clientId: 'c', startTime: '2024-01-01T00:00:00Z', durationMinutes: 30, ...over }
}

describe('resolveStaffProfileId', () => {
  it('prefers the new staffProfileId field', () => {
    expect(resolveStaffProfileId(input({ staffProfileId: 'new', staffId: 'legacy' }))).toBe('new')
  })

  it('falls back to the legacy staffId alias', () => {
    expect(resolveStaffProfileId(input({ staffId: 'legacy' }))).toBe('legacy')
  })

  it('uses staffProfileId when only it is set', () => {
    expect(resolveStaffProfileId(input({ staffProfileId: 'new' }))).toBe('new')
  })

  it('returns null when neither is set', () => {
    expect(resolveStaffProfileId(input({}))).toBeNull()
  })
})
