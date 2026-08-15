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

  it('監査ログ is owner-only by preset: audit.view ships in no role, only as a deliberate per-staff toggle (Liam 7/17)', () => {
    expect(new Set(ROLE_PRESETS.owner).has('audit.view')).toBe(true)
    for (const role of ['manager', 'senior', 'practitioner', 'frontdesk', 'custom'] as const) {
      expect(new Set(ROLE_PRESETS[role]).has('audit.view')).toBe(false)
    }
  })

  it('audit.view grant flow: an explicit override grants it, the preset alone never does', () => {
    // The owner ticking 監査ログ in StaffForm stores an override carrying
    // audit.view — that deliberate grant resolves as-is (viewer grant flow,
    // replaced the interim resolve-time strip when the viewer shipped).
    const granted = effectiveCapabilities('manager', [...presetCapabilities('manager'), 'audit.view'])
    expect(granted.has('audit.view')).toBe(true)
    // No override → preset only → no audit.view for any non-owner role.
    expect(effectiveCapabilities('manager', null).has('audit.view')).toBe(false)
    expect(effectiveCapabilities('owner', null).has('audit.view')).toBe(true)
  })

  it('raw recordings are recorder-private: only the owner keeps recordings.viewAll (Liam 7/16)', () => {
    expect(new Set(ROLE_PRESETS.owner).has('recordings.viewAll')).toBe(true)
    for (const role of ['manager', 'senior', 'practitioner', 'frontdesk', 'custom'] as const) {
      expect(new Set(ROLE_PRESETS[role]).has('recordings.viewAll')).toBe(false)
    }
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

  it('menu catalog (menus.manage): owner/manager/SV yes, regular staff no (Liam 8/12)', () => {
    expect(new Set(ROLE_PRESETS.owner).has('menus.manage')).toBe(true)
    expect(new Set(ROLE_PRESETS.manager).has('menus.manage')).toBe(true)
    expect(new Set(ROLE_PRESETS.senior).has('menus.manage')).toBe(true)
    for (const role of ['practitioner', 'frontdesk', 'custom'] as const) {
      expect(new Set(ROLE_PRESETS[role]).has('menus.manage')).toBe(false)
    }
    // override ?? preset: a senior customized before this capability existed
    // does NOT inherit it — their stored list is the whole truth (PR-1a §5).
    expect(effectiveCapabilities('senior', ['records.write']).has('menus.manage')).toBe(false)
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

  it('recordings.viewAll strips from every non-owner at resolve time — stale overrides included', () => {
    // A manager customized BEFORE the recorder-private ruling: their stored
    // override still carries recordings.viewAll. The preset change alone
    // can't fix that row — the resolve-time strip must.
    const stale = [...presetCapabilities('manager'), 'recordings.viewAll']
    const caps = effectiveCapabilities('manager', stale)
    expect(caps.has('recordings.viewAll')).toBe(false)
    // The rest of the override survives untouched.
    expect(caps.has('staff.manage')).toBe(true)
    // Owner keeps it (the dev/support key) — preset or explicit override.
    expect(effectiveCapabilities('owner', null).has('recordings.viewAll')).toBe(true)
    expect(effectiveCapabilities('owner', ['recordings.viewAll']).has('recordings.viewAll')).toBe(true)
    // No other role can hold it, even via an explicit grant.
    for (const role of ['senior', 'practitioner', 'frontdesk', 'custom'] as const) {
      expect(effectiveCapabilities(role, ['recordings.viewAll']).has('recordings.viewAll')).toBe(false)
    }
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
