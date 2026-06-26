import {
  CAPABILITIES,
  ROLE_PRESETS,
  effectiveCapabilities,
  presetCapabilities,
  synqedRoleToPreset,
  can,
  type Capability,
} from '@/lib/auth/permissions'

describe('RBAC permission model', () => {
  it('owner has every capability', () => {
    expect(new Set(ROLE_PRESETS.owner).size).toBe(CAPABILITIES.length)
  })

  it('manager runs the salon but not money/ownership — and CAN manage staff (per the matrix)', () => {
    const m = new Set(ROLE_PRESETS.manager)
    expect(m.has('billing.manage')).toBe(false)
    expect(m.has('business.manage')).toBe(false)
    expect(m.has('staff.manage')).toBe(true)
    expect(m.has('staff.invite')).toBe(true)
    expect(m.has('settings.manage')).toBe(true)
    expect(m.has('records.delete')).toBe(true)
  })

  it('practitioner records work but cannot administer', () => {
    const p = new Set(ROLE_PRESETS.practitioner)
    expect(p.has('records.write')).toBe(true)
    expect(p.has('customers.view')).toBe(true)
    expect(p.has('staff.invite')).toBe(false)
    expect(p.has('billing.manage')).toBe(false)
    expect(p.has('records.delete')).toBe(false)
  })

  it('front desk views + books but never records or deletes', () => {
    const f = new Set(ROLE_PRESETS.frontdesk)
    expect(f.has('bookings.manage')).toBe(true)
    expect(f.has('customers.view')).toBe(true)
    expect(f.has('records.write')).toBe(false)
    expect(f.has('records.delete')).toBe(false)
  })

  it('custom starts empty (toggle up from scratch)', () => {
    expect(ROLE_PRESETS.custom).toEqual([])
  })

  it('cross-store visibility (stores.viewAll): owner/manager/SV yes, regular staff no', () => {
    expect(new Set(ROLE_PRESETS.owner).has('stores.viewAll')).toBe(true)
    expect(new Set(ROLE_PRESETS.manager).has('stores.viewAll')).toBe(true)
    expect(new Set(ROLE_PRESETS.senior).has('stores.viewAll')).toBe(true)
    // Branch-restricted by default — they get clamped to their staff_stores.
    expect(new Set(ROLE_PRESETS.practitioner).has('stores.viewAll')).toBe(false)
    expect(new Set(ROLE_PRESETS.frontdesk).has('stores.viewAll')).toBe(false)
  })

  it('an explicit override replaces the preset (the toggle mechanism)', () => {
    const caps = effectiveCapabilities('frontdesk', ['billing.manage'])
    expect(can(caps, 'billing.manage')).toBe(true) // granted explicitly
    expect(can(caps, 'bookings.manage')).toBe(false) // override replaces preset
  })

  it('drops unknown/stale capabilities from a stored override (forward-compatible)', () => {
    const caps = effectiveCapabilities('custom', ['records.write', 'not.a.real.cap'])
    expect(caps.has('records.write' as Capability)).toBe(true)
    expect(caps.size).toBe(1)
  })

  it('a null override falls back to the role preset', () => {
    expect(effectiveCapabilities('practitioner', null)).toEqual(
      new Set(presetCapabilities('practitioner')),
    )
  })

  it('maps synqed roles → presets, with a safe default', () => {
    expect(synqedRoleToPreset('OWNER')).toBe('owner')
    expect(synqedRoleToPreset('ADMIN')).toBe('manager')
    expect(synqedRoleToPreset('STYLIST')).toBe('practitioner')
    expect(synqedRoleToPreset('ASSISTANT')).toBe('frontdesk')
    expect(synqedRoleToPreset(null)).toBe('practitioner')
    expect(synqedRoleToPreset('weird')).toBe('practitioner')
  })
})
