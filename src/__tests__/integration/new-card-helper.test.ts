import { audit } from '@/lib/audit'
import { STAFF_STORE_REQUIRED } from '@/lib/auth/store-gate'
import {
  createAndPlaceStaffCard,
  STAFF_CARD_LEFT_BEHIND,
  type NewCardClient,
  type NewCardDeps,
} from '@/lib/staff/new-card'

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {},
  SynqedError: class extends Error {},
}))
jest.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
jest.mock('@/lib/business-name', () => ({ businessDisplayName: async () => 'Main store' }))

const DEPS: NewCardDeps = {
  actorId: 'owner-1',
  source: 'web',
  requestId: 'req-1',
  creatorAllowedStoreIds: ['store-ginza'],
}
const CARD = { name: '田中', email: null, userId: null, storeIds: [] as string[] }

function client() {
  const fake = {
    staff: {
      create: jest.fn().mockResolvedValue({ id: 'staff-new' }),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    stores: {
      list: jest.fn().mockResolvedValue({ stores: [{ id: 'store-ginza' }, { id: 'store-daikanyama' }] }),
    },
    staffStores: {
      set: jest.fn().mockResolvedValue(undefined),
    },
  }
  return { fake, synqed: fake as unknown as NewCardClient }
}

beforeEach(() => {
  jest.resetAllMocks()
})

describe('createAndPlaceStaffCard directly', () => {
  it('refuses an unplaced card in two or more stores before staff.create', async () => {
    const { fake, synqed } = client()
    await expect(createAndPlaceStaffCard(synqed, 'biz-1', DEPS, CARD))
      .resolves.toEqual({ error: STAFF_STORE_REQUIRED })
    expect(fake.staff.create).not.toHaveBeenCalled()
  })

  it('creates an unplaced card in one store without storeUnknown', async () => {
    const { fake, synqed } = client()
    fake.stores.list.mockResolvedValue({ stores: [{ id: 'store-ginza' }] })
    await expect(createAndPlaceStaffCard(synqed, 'biz-1', DEPS, CARD))
      .resolves.toEqual({ id: 'staff-new' })
    expect(fake.staff.create).toHaveBeenCalledTimes(1)
  })

  it('reports storeUnknown when stores.list rejects', async () => {
    const { fake, synqed } = client()
    fake.stores.list.mockRejectedValue(new Error('stores unavailable'))
    await expect(createAndPlaceStaffCard(synqed, 'biz-1', DEPS, CARD))
      .resolves.toEqual({ id: 'staff-new', storeUnknown: true })
    expect(fake.staff.create).toHaveBeenCalledTimes(1)
  })

  it('places inside the creator scope once and audits at_creation once', async () => {
    const { fake, synqed } = client()
    await expect(createAndPlaceStaffCard(synqed, 'biz-1', DEPS, {
      ...CARD, storeIds: ['store-ginza'],
    })).resolves.toEqual({ id: 'staff-new' })
    expect(fake.staffStores.set).toHaveBeenCalledTimes(1)
    expect(fake.staffStores.set).toHaveBeenCalledWith('staff-new', ['store-ginza'])
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'settings.staff_stores_change',
      targetId: 'staff-new',
      detail: expect.objectContaining({ at_creation: true }),
    }))
  })

  it('deletes an outside-scope card once and emits no staff.add row', async () => {
    const { fake, synqed } = client()
    await expect(createAndPlaceStaffCard(synqed, 'biz-1', DEPS, {
      ...CARD, storeIds: ['store-daikanyama'],
    })).resolves.toEqual({ error: 'STORE_SCOPE_DENIED' })
    expect(fake.staffStores.set).not.toHaveBeenCalled()
    expect(fake.staff.delete).toHaveBeenCalledTimes(1)
    expect(fake.staff.delete).toHaveBeenCalledWith('staff-new')
    expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'staff.add' }))
  })

  it('reports a failed rollback and emits exactly one warning staff.add row', async () => {
    const { fake, synqed } = client()
    fake.staffStores.set.mockRejectedValue(new Error('placement failed'))
    fake.staff.delete.mockRejectedValue(new Error('delete failed'))
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(createAndPlaceStaffCard(synqed, 'biz-1', DEPS, {
        ...CARD, storeIds: ['store-ginza'],
      })).resolves.toEqual({ error: STAFF_CARD_LEFT_BEHIND })
      expect(fake.staff.delete).toHaveBeenCalledTimes(1)
      expect(fake.staff.delete).toHaveBeenCalledWith('staff-new')
      expect(audit).toHaveBeenCalledTimes(1)
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'staff.add',
        severity: 'warning',
        targetId: 'staff-new',
        detail: expect.objectContaining({ reason: 'rollback_failed' }),
      }))
    } finally {
      consoleError.mockRestore()
    }
  })

  it('refuses a missing staffStores port and deletes the card', async () => {
    const { fake } = client()
    const synqed = { staff: fake.staff, stores: fake.stores } as unknown as NewCardClient
    await expect(createAndPlaceStaffCard(synqed, 'biz-1', DEPS, {
      ...CARD, storeIds: ['store-ginza'],
    })).resolves.toEqual({ error: 'STORE_SCOPE_DENIED' })
    expect(fake.staff.delete).toHaveBeenCalledTimes(1)
    expect(fake.staff.delete).toHaveBeenCalledWith('staff-new')
  })

  it('refuses an undefined creator scope before staff.create', async () => {
    const { fake, synqed } = client()
    const deps = { ...DEPS, creatorAllowedStoreIds: undefined } as unknown as NewCardDeps
    await expect(createAndPlaceStaffCard(synqed, 'biz-1', deps, {
      ...CARD, storeIds: ['store-ginza'],
    })).resolves.toEqual({ error: 'STORE_SCOPE_DENIED' })
    expect(fake.staff.create).not.toHaveBeenCalled()
    expect(fake.staffStores.set).not.toHaveBeenCalled()
    expect(fake.staff.delete).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('places with an explicitly unclamped null creator scope', async () => {
    const { fake, synqed } = client()
    await expect(createAndPlaceStaffCard(synqed, 'biz-1', {
      ...DEPS, creatorAllowedStoreIds: null,
    }, { ...CARD, storeIds: ['store-daikanyama'] })).resolves.toEqual({ id: 'staff-new' })
    expect(fake.staffStores.set).toHaveBeenCalledTimes(1)
    expect(fake.staffStores.set).toHaveBeenCalledWith('staff-new', ['store-daikanyama'])
  })

  it('rejects when staff.create rejects so each door can map the failure', async () => {
    const { fake, synqed } = client()
    const error = new Error('staff unavailable')
    fake.staff.create.mockRejectedValue(error)
    await expect(createAndPlaceStaffCard(synqed, 'biz-1', DEPS, {
      ...CARD, storeIds: ['store-ginza'],
    })).rejects.toBe(error)
    expect(fake.staffStores.set).not.toHaveBeenCalled()
    expect(fake.staff.delete).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })
})
