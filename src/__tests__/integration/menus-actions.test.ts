/**
 * Menu catalog server actions (PR-1a create side + PR-1b update side, no UI):
 * the menus.manage gate on all five actions, the audit row each write emits,
 * and the pure band validator PR-3's dialog will share. The taxonomy/totality/
 * parity suites cover the registry + label side.
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('@/lib/auth/require-permission', () => ({ can: jest.fn(async () => true) }))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'biz-1'),
  getCurrentUserStaffId: jest.fn(async () => 'user-1'),
}))
const mockMenus = { list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn() }
const mockStores = { get: jest.fn() }
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ menus: mockMenus, stores: mockStores })),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))

import { revalidatePath as revalidatePathImport } from 'next/cache'

import { listMenus, createMenu, updateMenu, retireMenu, reactivateMenu } from '@/actions/menus'
import { menuBandError } from '@/lib/validations/menu'
import { can as canImport } from '@/lib/auth/require-permission'
import { audit as auditImport } from '@/lib/audit'

const can = canImport as jest.Mock
const audit = auditImport as jest.Mock
const revalidatePath = revalidatePathImport as jest.Mock

// The actions validate the id as a uuid before any core call, so the fixture
// row carries a real one.
const MENU_ID = '3f2f1a10-7b4c-4d9e-8a21-5c6d7e8f9a0b'
const MENU = {
  id: MENU_ID,
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
  mockMenus.get.mockResolvedValue(MENU)
  mockMenus.create.mockResolvedValue(MENU)
  mockMenus.update.mockResolvedValue(MENU)
  mockStores.get.mockResolvedValue({ id: STORE_ID })
})

describe('menus.manage gate', () => {
  const calls: [string, () => Promise<unknown>][] = [
    ['listMenus', () => listMenus()],
    ['createMenu', () => createMenu(FORM)],
    ['updateMenu', () => updateMenu(MENU_ID, FORM)],
    ['retireMenu', () => retireMenu(MENU_ID)],
    ['reactivateMenu', () => reactivateMenu(MENU_ID)],
  ]

  it.each(calls)('%s returns { error } and touches nothing when the capability is missing', async (_n, run) => {
    can.mockImplementation(async () => false)
    expect(await run()).toEqual({ error: expect.stringContaining('permission') })
    expect(mockMenus.create).not.toHaveBeenCalled()
    expect(mockMenus.update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it.each(calls)('%s proceeds when the capability is held', async (_n, run) => {
    expect(await run()).not.toHaveProperty('error')
    expect(can).toHaveBeenCalledWith('menus.manage')
  })
})

describe('writes', () => {
  it('createMenu returns the new id and audits settings.menu_create', async () => {
    expect(await createMenu(FORM)).toEqual({ id: MENU_ID })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.menu_create',
        category: 'settings',
        targetType: 'menu',
        targetId: MENU_ID,
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
    expect(await createMenu({ ...FORM, store_id: STORE_ID })).toEqual({ id: MENU_ID })
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

  it('createMenu rejects an empty name before touching core (schema boundary)', async () => {
    expect(await createMenu({ ...FORM, name: '  ' })).toEqual({ error: expect.stringContaining('required') })
    expect(mockMenus.create).not.toHaveBeenCalled()
  })

  it('listMenus returns the whole catalog (retired rows included) and audits nothing', async () => {
    expect(await listMenus()).toEqual({ menus: [MENU] })
    expect(mockMenus.list).toHaveBeenCalledWith()
    expect(audit).not.toHaveBeenCalled()
  })

  it('updateMenu audits CHANGED fields only — free text as a bare flag, never a value', async () => {
    mockMenus.get.mockResolvedValue({ ...MENU, name: '旧カット', category: 'カラー', price_list_amount: 4000 })
    mockMenus.update.mockResolvedValue({ ...MENU, price_list_amount: 5000 })

    expect(await updateMenu(MENU_ID, FORM)).toEqual({ ok: true })
    const event = audit.mock.calls[0][0]
    expect(event.action).toBe('settings.menu_update')
    expect(event.targetType).toBe('menu')
    expect(event.targetId).toBe(MENU_ID)
    // Exact: the unchanged duration_minutes is ABSENT, and name/category carry
    // no value keys at all (audit.ts PII rule — a menu name is staff free text).
    expect(event.detail).toEqual({
      price_list_amount_old: 4000,
      price_list_amount_new: 5000,
      name_changed: true,
      category_changed: true,
    })
    expect(event.detail.name_old).toBeUndefined()
    expect(event.detail.category_old).toBeUndefined()
    expect(JSON.stringify(event)).not.toContain('カット')
    expect(JSON.stringify(event)).not.toContain('カラー')
  })

  it('updateMenu sends the exact core payload (nulls explicit, ¥0 floor preserved)', async () => {
    await updateMenu(MENU_ID, {
      name: 'カット',
      category: '',
      duration_minutes: 60,
      price_list_amount: 5000,
      price_min_amount: 0,
      store_id: STORE_ID,
      online_visible: false,
      display_order: 10,
    })
    expect(mockMenus.update).toHaveBeenCalledWith(MENU_ID, {
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

  it('updateMenu tenant-validates store_id and refuses a store core will not return', async () => {
    mockStores.get.mockRejectedValue(new Error('not found'))
    expect(await updateMenu(MENU_ID, { ...FORM, store_id: STORE_ID })).toEqual({
      error: expect.stringContaining('not found'),
    })
    expect(mockMenus.update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('updateMenu checks EVERY non-null store_id, moved or not, and skips only the all-store menu', async () => {
    expect(await updateMenu(MENU_ID, FORM)).toEqual({ ok: true }) // store_id null
    expect(mockStores.get).not.toHaveBeenCalled()
    // Same store the row already carries — createMenu's rule checks it anyway.
    mockMenus.get.mockResolvedValue({ ...MENU, store_id: STORE_ID })
    expect(await updateMenu(MENU_ID, { ...FORM, store_id: STORE_ID })).toEqual({ ok: true })
    expect(mockStores.get).toHaveBeenCalledWith(STORE_ID)
  })

  it('retireMenu flips active:false and audits settings.menu_retire', async () => {
    expect(await retireMenu(MENU_ID)).toEqual({ ok: true })
    expect(mockMenus.update).toHaveBeenCalledWith(MENU_ID, { active: false })
    expect(audit.mock.calls[0][0].action).toBe('settings.menu_retire')
  })

  it('reactivateMenu flips active:true and audits settings.menu_reactivate', async () => {
    expect(await reactivateMenu(MENU_ID)).toEqual({ ok: true })
    expect(mockMenus.update).toHaveBeenCalledWith(MENU_ID, { active: true })
    expect(audit.mock.calls[0][0].action).toBe('settings.menu_reactivate')
  })

  it('a core failure returns { error } and audits nothing', async () => {
    mockMenus.create.mockRejectedValue(new Error('core down'))
    expect(await createMenu(FORM)).toEqual({ error: expect.stringContaining('core down') })
    expect(audit).not.toHaveBeenCalled()
  })

  // The three writers PR-1b adds, with the audit action each one emits.
  const writers: [string, string, () => Promise<unknown>][] = [
    ['updateMenu', 'settings.menu_update', () => updateMenu(MENU_ID, FORM)],
    ['retireMenu', 'settings.menu_retire', () => retireMenu(MENU_ID)],
    ['reactivateMenu', 'settings.menu_reactivate', () => reactivateMenu(MENU_ID)],
  ]

  it.each(writers)('%s surfaces a failed core write as { error } and audits nothing', async (_n, _a, run) => {
    mockMenus.update.mockRejectedValue(new Error('core down'))
    expect(await run()).toHaveProperty('error')
    expect(audit).not.toHaveBeenCalled()
  })

  it('updateMenu writes and audits nothing when the before-read fails', async () => {
    mockMenus.get.mockRejectedValue(new Error('core down'))
    expect(await updateMenu(MENU_ID, FORM)).toEqual({ error: expect.stringContaining('core down') })
    expect(mockMenus.update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it.each(writers)('%s carries the whole audit envelope', async (_n, action, run) => {
    await run()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action,
        category: 'settings',
        targetType: 'menu',
        targetId: MENU_ID,
        actorId: 'user-1',
        actorType: 'staff',
        businessId: 'biz-1',
        source: 'web',
      }),
    )
  })

  it('updateMenu rejects a bad band before touching core', async () => {
    expect(await updateMenu(MENU_ID, { ...FORM, price_min_amount: 6000 })).toEqual({
      error: expect.stringMatching(/above the list price/),
    })
    expect(mockMenus.get).not.toHaveBeenCalled()
    expect(mockMenus.update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('updateMenu rejects an empty name before touching core (schema boundary)', async () => {
    expect(await updateMenu(MENU_ID, { ...FORM, name: '  ' })).toEqual({
      error: expect.stringContaining('required'),
    })
    expect(mockMenus.get).not.toHaveBeenCalled()
    expect(mockMenus.update).not.toHaveBeenCalled()
  })

  it('updateMenu reports EVERY schema issue, not just the first', async () => {
    // The only case that distinguishes join(', ') from issues[0].message.
    expect(await updateMenu(MENU_ID, { ...FORM, name: '  ', duration_minutes: 0 })).toEqual({
      error: 'Menu name is required, Duration must be more than 0 minutes',
    })
    expect(mockMenus.update).not.toHaveBeenCalled()
  })

  it('updateMenu audits every field it sends to core — nothing escapes the detail', async () => {
    const moved = {
      name: '旧カット', category: 'カラー', duration_minutes: 30, price_list_amount: 4000,
      price_min_amount: 3000, store_id: STORE_ID, online_visible: false, display_order: 10,
    }
    mockMenus.update.mockResolvedValue({ ...MENU, ...moved })

    expect(await updateMenu(MENU_ID, moved)).toEqual({ ok: true })
    // Black box (the action file is 'use server' — TRACKED/FREE_TEXT are not
    // importable): every key of the payload core actually received must land in
    // the detail as an old/new pair OR a bare *_changed flag, never neither. Read
    // off the payload, so a field added to toPayload joins this assertion on its own.
    const detail = audit.mock.calls[0][0].detail
    for (const key of Object.keys(mockMenus.update.mock.calls[0][1])) {
      const covered = (`${key}_old` in detail && `${key}_new` in detail) || `${key}_changed` in detail
      expect({ key, covered }).toEqual({ key, covered: true })
    }
  })

  it('a field core OMITS still audits a COMPLETE old/new pair — null, never a half pair', async () => {
    const before: Partial<typeof MENU> = { ...MENU }
    delete before.display_order // core omitted this one on the read...
    const after: Partial<typeof MENU> = { ...MENU, display_order: 10 }
    delete after.duration_minutes // ...and a different one on the write
    mockMenus.get.mockResolvedValue(before)
    mockMenus.update.mockResolvedValue(after)

    expect(await updateMenu(MENU_ID, { ...FORM, display_order: 10 })).toEqual({ ok: true })
    // Round-tripped, because that is what the audit layer does: an undefined
    // half would vanish in JSON.stringify and leave the reader a lone _new.
    const detail = JSON.parse(JSON.stringify(audit.mock.calls[0][0].detail))
    expect(detail.display_order_old).toBeNull()
    expect(detail.display_order_new).toBe(10)
    expect(detail.duration_minutes_old).toBe(60)
    expect(detail.duration_minutes_new).toBeNull()
  })

  it('an undefined field against an explicit null is NO change — no pair at all', async () => {
    const before: Record<string, unknown> = { ...MENU }
    delete before.display_order // core omitted these on the read...
    delete before.category
    mockMenus.get.mockResolvedValue(before)
    mockMenus.update.mockResolvedValue({ ...MENU, display_order: null }) // ...and returned them null

    expect(await updateMenu(MENU_ID, FORM)).toEqual({ ok: true })
    // absent-vs-cleared is a no-op, not an edit — a raw undefined !== null
    // comparison would log a phantom change on a field nobody touched. Both
    // compare loops: display_order is TRACKED, category is FREE_TEXT.
    const detail = audit.mock.calls[0][0].detail
    expect(detail).not.toHaveProperty('display_order_old')
    expect(detail).not.toHaveProperty('display_order_new')
    expect(detail).not.toHaveProperty('category_changed')
  })

  it.each(writers)('%s revalidates /settings on success', async (_n, _a, run) => {
    expect(await run()).not.toHaveProperty('error')
    expect(revalidatePath).toHaveBeenCalledWith('/settings')
  })

  it('a partial form PATCHes the cleared nullables as null and omits the untouched optionals', async () => {
    await updateMenu(MENU_ID, { name: 'カット', duration_minutes: 60, price_list_amount: 5000 })
    // Pin the WIRE shape: the SDK sends JSON.stringify(body), so an undefined
    // key never leaves the app. toEqual alone cannot prove that — it reads
    // { a: undefined } as {} — hence the round-trip.
    expect(JSON.parse(JSON.stringify(mockMenus.update.mock.calls[0][1]))).toEqual({
      name: 'カット',
      category: null,
      duration_minutes: 60,
      price_list_amount: 5000,
      price_min_amount: null,
      store_id: null,
    })
  })

  it('updateMenu refuses a non-uuid id before touching core', async () => {
    // One action is enough: the three id-taking writers share this guard,
    // placed identically right after the capability gate.
    expect(await updateMenu('menu-1', FORM)).toEqual({ error: expect.stringContaining('Invalid menu id') })
    expect(mockMenus.get).not.toHaveBeenCalled()
    expect(mockMenus.update).not.toHaveBeenCalled()
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
})
