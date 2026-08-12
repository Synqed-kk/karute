/**
 * Menu catalog server actions (PR-1a create-side plumbing, no UI): the
 * menus.manage gate on listMenus + createMenu, the audit row the write emits,
 * and the pure band validator PR-3's dialog will share. The taxonomy/totality/
 * parity suites cover the registry + label side. (Update / retire / reactivate
 * and their tests land with PR-1b.)
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/auth/require-permission', () => ({ can: jest.fn(async () => true) }))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  getCurrentUserStaffId: jest.fn(async () => 'user-1'),
}))
const mockMenus = { list: jest.fn(), create: jest.fn() }
const mockStores = { get: jest.fn() }
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ menus: mockMenus, stores: mockStores })),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))

import { listMenus, createMenu } from '@/actions/menus'
import { menuBandError } from '@/lib/validations/menu'
import { can as canImport } from '@/lib/auth/require-permission'
import { audit as auditImport } from '@/lib/audit'

const can = canImport as jest.Mock
const audit = auditImport as jest.Mock

const MENU = {
  id: 'menu-1',
  business_id: 'biz-1',
  store_id: null,
  name: 'カット',
  description: null,
  category: null,
  category_display_order: 0,
  display_order: 0,
  duration_minutes: 60,
  price_list_amount: 5000,
  price_min_amount: null,
  currency: 'JPY',
  tax_included: true,
  nomination_allowed: true,
  online_visible: true,
  active: true,
  created_at: '2026-08-13T00:00:00Z',
  updated_at: '2026-08-13T00:00:00Z',
}
const FORM = { name: 'カット', duration_minutes: 60, price_list_amount: 5000 }
const STORE_ID = '4f1c9b2e-8d3a-4c17-9f5e-2b6a7c8d9e01'

beforeEach(() => {
  jest.clearAllMocks()
  can.mockImplementation(async () => true)
  mockMenus.list.mockResolvedValue({ menus: [MENU] })
  mockMenus.create.mockResolvedValue(MENU)
  mockStores.get.mockResolvedValue({ id: STORE_ID })
})

describe('menus.manage gate', () => {
  const calls: [string, () => Promise<unknown>][] = [
    ['listMenus', () => listMenus()],
    ['createMenu', () => createMenu(FORM)],
  ]

  it.each(calls)('%s returns { error } and touches nothing when the capability is missing', async (_n, run) => {
    can.mockImplementation(async () => false)
    expect(await run()).toEqual({ error: expect.stringContaining('permission') })
    expect(mockMenus.create).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it.each(calls)('%s proceeds when the capability is held', async (_n, run) => {
    expect(await run()).not.toHaveProperty('error')
    expect(can).toHaveBeenCalledWith('menus.manage')
  })
})

describe('writes', () => {
  it('createMenu returns the new id and audits settings.menu_create', async () => {
    expect(await createMenu(FORM)).toEqual({ id: 'menu-1' })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.menu_create',
        category: 'settings',
        targetType: 'menu',
        targetId: 'menu-1',
        actorId: 'user-1',
        businessId: 'biz-1',
        source: 'web',
      }),
    )
    // ids only — the menu NAME must never ride the row (audit.ts PII rule).
    const event = audit.mock.calls[0][0]
    expect(event.detail).toBeUndefined()
    expect(JSON.stringify(event)).not.toContain('カット')
  })

  it('createMenu sends the exact core payload (nulls explicit, 0 preserved)', async () => {
    await createMenu({
      name: 'カット',
      category: '',
      duration_minutes: 60,
      price_list_amount: 5000,
      price_min_amount: 0,
      store_id: STORE_ID,
      online_visible: false,
      display_order: 10,
    })
    expect(mockMenus.create).toHaveBeenCalledWith({
      name: 'カット',
      category: null,
      duration_minutes: 60,
      price_list_amount: 5000,
      price_min_amount: 0,
      store_id: STORE_ID,
      online_visible: false,
      display_order: 10,
    })
  })

  it('createMenu tenant-validates store_id and refuses a store core will not return', async () => {
    mockStores.get.mockRejectedValue(new Error('not found'))
    expect(await createMenu({ ...FORM, store_id: STORE_ID })).toEqual({
      error: expect.stringContaining('not found'),
    })
    expect(mockMenus.create).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('createMenu creates once the store resolves in this tenant', async () => {
    expect(await createMenu({ ...FORM, store_id: STORE_ID })).toEqual({ id: 'menu-1' })
    expect(mockStores.get).toHaveBeenCalledWith(STORE_ID)
    expect(mockMenus.create).toHaveBeenCalled()
  })

  it('createMenu rejects a bad band before touching core', async () => {
    expect(await createMenu({ ...FORM, price_min_amount: 6000 })).toEqual({
      error: expect.stringMatching(/above the list price/),
    })
    expect(mockMenus.create).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('listMenus returns the whole catalog (retired rows included) and audits nothing', async () => {
    expect(await listMenus()).toEqual({ menus: [MENU] })
    expect(mockMenus.list).toHaveBeenCalledWith()
    expect(audit).not.toHaveBeenCalled()
  })

  it('a core failure returns { error } and audits nothing', async () => {
    mockMenus.create.mockRejectedValue(new Error('core down'))
    expect(await createMenu(FORM)).toEqual({ error: expect.stringContaining('core down') })
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('menuBandError (pure — PR-3 dialog shares it)', () => {
  const band = (over: Partial<{ duration_minutes: number; price_list_amount: number; price_min_amount: number | null }>) =>
    menuBandError({ duration_minutes: 60, price_list_amount: 5000, ...over })

  it('accepts a valid band', () => expect(band({ price_min_amount: 4000 })).toBeNull())
  it('accepts floor == ceiling', () => expect(band({ price_min_amount: 5000 })).toBeNull())
  it('accepts a null floor (fixed price)', () => expect(band({ price_min_amount: null })).toBeNull())
  it('rejects floor > ceiling', () => expect(band({ price_min_amount: 6000 })).toMatch(/above the list price/))
  it('rejects a negative price', () => expect(band({ price_list_amount: -1 })).toMatch(/negative/))
  it('rejects zero duration', () => expect(band({ duration_minutes: 0 })).toMatch(/more than 0/))
  // A cleared numeric field arrives as NaN, which fails every comparison —
  // without the finite guards these four all read as "no error".
  it('rejects NaN duration', () => expect(band({ duration_minutes: NaN })).not.toBeNull())
  it('rejects NaN price', () => expect(band({ price_list_amount: NaN })).not.toBeNull())
  it('rejects NaN floor', () => expect(band({ price_min_amount: NaN })).not.toBeNull())
  it('rejects Infinity price', () => expect(band({ price_list_amount: Infinity })).not.toBeNull())

  it('createMenu rejects an empty name before touching core (schema boundary)', async () => {
    expect(await createMenu({ ...FORM, name: '  ' })).toEqual({ error: expect.stringContaining('required') })
    expect(mockMenus.create).not.toHaveBeenCalled()
  })
})
