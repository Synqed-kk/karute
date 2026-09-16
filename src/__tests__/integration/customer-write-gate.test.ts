// THE CUSTOMER-PROFILE WRITE GATE (⚖ Liam 2026-09-16).
//
// createCustomer / createQuickCustomer / updateCustomer carried NO capability
// check at all on the web transport — any authenticated staff member could
// create or edit a customer profile — while their facade twins held only
// customers.view, the READ tier. `customers.manage` is the write tier, seeded
// into EVERY shipped preset in parity with bookings.manage, so no real role
// loses a door; only a custom role with nothing toggled now lacks it.
//
// ⚠ CAPABILITY ONLY, on purpose. Customers carry no store_id — identity is
// business-wide and store membership is DERIVED from events inside core — so
// "is this customer a member of MY store?" has no answer in this app today.
// That rule waits for core's membership change and is NOT in this gate.

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next-intl/server', () => ({ getTranslations: jest.fn(async () => (k: string) => k) }))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn(async () => undefined) }))

const held = { current: new Set<string>(['customers.manage']) }
jest.mock('@/lib/auth/require-permission', () => ({
  can: jest.fn(async (cap: string) => held.current.has(cap)),
  requireCapability: jest.fn(async (cap: string) => {
    if (!held.current.has(cap)) throw new Error('forbidden')
  }),
}))

const create = jest.fn(async (input: { name: string }) => ({ id: 'cust-new', name: input.name }))
const update = jest.fn(async () => ({ id: 'cust-1' }))
const checkDuplicate = jest.fn(async () => ({ exists: false }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ customers: { create, update, checkDuplicate } })),
}))

import {
  CAPABILITIES,
  NOT_YET_TOGGLEABLE,
  PERMISSION_ROLES,
  effectiveCapabilities,
  presetCapabilities,
  type PermissionRole,
} from '@/lib/auth/permissions'
import { createCustomer, createQuickCustomer, updateCustomer } from '@/actions/customers'

const DENIED = 'You do not have permission to add or edit customers.'

beforeEach(() => {
  jest.clearAllMocks()
  held.current = new Set(['customers.manage'])
})

describe('customers.manage — the capability itself', () => {
  it('is a real capability, declared once', () => {
    expect(CAPABILITIES.filter((c) => c === 'customers.manage')).toHaveLength(1)
  })

  it('every shipped preset holds it — except `custom`, the deliberate blank canvas', () => {
    const missing = PERMISSION_ROLES.filter(
      (r: PermissionRole) => !presetCapabilities(r).includes('customers.manage'),
    )
    expect(missing).toEqual(['custom'])
  })

  it('it ships in exact parity with bookings.manage, the capability it was modelled on', () => {
    for (const role of PERMISSION_ROLES) {
      const caps = presetCapabilities(role)
      expect({ role, manage: caps.includes('customers.manage') }).toEqual({
        role,
        manage: caps.includes('bookings.manage'),
      })
    }
  })
})

// ⚖ 2026-09-16 — THE LIVE-DATA HALF. An override is stored only when it
// DIFFERS from its preset, so every override in the database today was written
// before this capability existed and cannot name it. Resolving such a row
// literally would take customer create/edit away from exactly the staff an
// owner had already customised.
describe('effectiveCapabilities — the one implied capability', () => {
  it('an override carrying customers.view gains customers.manage with it', () => {
    const caps = effectiveCapabilities('practitioner', ['customers.view', 'records.write'])
    expect(caps.has('customers.manage')).toBe(true)
    expect(caps.has('customers.view')).toBe(true)
  })

  it('an override WITHOUT customers.view does NOT gain it — the read tier is the trigger', () => {
    const caps = effectiveCapabilities('practitioner', ['records.write'])
    expect(caps.has('customers.manage')).toBe(false)
  })

  // ⚖ Greptile round 2 — REVOCATION. The rule goes both ways: an EXPLICIT
  // manage with no view is dropped, not kept. StaffForm submits the effective
  // set, so an owner unticking 顧客の閲覧 used to store exactly this shape and
  // the add-only rule left the write tier standing — the person kept creating
  // and editing customers they could not see.
  it('an override naming customers.manage but NOT customers.view loses manage', () => {
    const caps = effectiveCapabilities('practitioner', ['records.write', 'customers.manage'])
    expect(caps.has('customers.manage')).toBe(false)
    expect(caps.has('records.write')).toBe(true)
  })

  it('an override naming BOTH keeps both', () => {
    const caps = effectiveCapabilities('frontdesk', ['customers.view', 'customers.manage'])
    expect([...caps].sort()).toEqual(['customers.manage', 'customers.view'])
  })

  it('an empty override stays empty — a blank custom role is still blank', () => {
    expect(effectiveCapabilities('custom', []).size).toBe(0)
  })

  it('the PRESET path is untouched — every preset resolves exactly to its own list', () => {
    for (const role of PERMISSION_ROLES) {
      expect([...effectiveCapabilities(role, null)].sort()).toEqual([...presetCapabilities(role)].sort())
      expect([...effectiveCapabilities(role, undefined)].sort()).toEqual([...presetCapabilities(role)].sort())
    }
  })

  // The rule and the missing checkbox are ONE decision: while the sheet cannot
  // express a removal, an absence always means "this row predates the
  // capability". If a toggle ever ships without the rule being retired, it
  // would be a checkbox that never sticks.
  it('the permissions sheet does not offer it, which is what makes the rule safe', () => {
    expect(NOT_YET_TOGGLEABLE.has('customers.manage')).toBe(true)
  })
})

describe('the three web write doors refuse without it', () => {
  beforeEach(() => {
    held.current = new Set(['customers.view']) // read tier only — the old state
  })

  it('createCustomer refuses before any core call', async () => {
    expect(await createCustomer({ name: '田中 美咲' } as never)).toEqual({
      success: false,
      error: DENIED,
    })
    expect(create).not.toHaveBeenCalled()
    expect(checkDuplicate).not.toHaveBeenCalled()
  })

  it('createQuickCustomer refuses before any core call', async () => {
    expect(await createQuickCustomer('田中 美咲')).toEqual({ success: false, error: DENIED })
    expect(create).not.toHaveBeenCalled()
  })

  it('updateCustomer refuses before any core call', async () => {
    expect(await updateCustomer('cust-1', { name: '田中 美咲' })).toEqual({
      success: false,
      error: DENIED,
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('a completely capability-less account is refused the same way', async () => {
    held.current = new Set()
    expect(await createCustomer({ name: '田中 美咲' } as never)).toMatchObject({ success: false })
    expect(create).not.toHaveBeenCalled()
  })
})

describe('the three web write doors are unchanged for every real role', () => {
  it.each(PERMISSION_ROLES.filter((r) => r !== 'custom'))('%s can still create', async (role) => {
    held.current = new Set<string>(presetCapabilities(role))
    expect(await createCustomer({ name: '田中 美咲' } as never)).toMatchObject({ success: true })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it.each(PERMISSION_ROLES.filter((r) => r !== 'custom'))('%s can still edit', async (role) => {
    held.current = new Set<string>(presetCapabilities(role))
    expect(await updateCustomer('cust-1', { name: '田中 美咲' })).toMatchObject({ success: true })
    expect(update).toHaveBeenCalledTimes(1)
  })

  it.each(PERMISSION_ROLES.filter((r) => r !== 'custom'))('%s can still quick-create', async (role) => {
    held.current = new Set<string>(presetCapabilities(role))
    expect(await createQuickCustomer('田中 美咲')).toMatchObject({ success: true })
    expect(create).toHaveBeenCalledTimes(1)
  })
})
