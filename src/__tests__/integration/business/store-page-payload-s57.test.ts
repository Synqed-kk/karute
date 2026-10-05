/**
 * S57 P3 NIT 1 — the gate is asked BEFORE the capabilities read (settings-props.ts, `storeCaps`): a reader without
 * settings.manage builds the whole settings payload with ZERO calls to readStoreCapabilities. The owner control
 * shows the counted mock is the one the page calls. Harness: store-page-section.test.tsx's recorded Dev Salon set.
 */
const mockCore: { reaches: number } = { reaches: 0 }
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
jest.mock('@/business/lib/data', () => {
  const actual = jest.requireActual('@/business/lib/data')
  return { ...actual, readStoreCapabilities: jest.fn(actual.readStoreCapabilities) }
})
jest.mock('@/business/lib/practice-door/core-reach', () => {
  const { practiceTenant } = jest.requireActual('@/business/lib/practice-door/switch')
  class PracticeTenantMismatch extends Error {
    businessId: string
    constructor(businessId: string) { super(`practice switch refused business ${businessId}`); this.name = 'PracticeTenantMismatch'; this.businessId = businessId }
  }
  const guard = (admitted: { businessId: string }) => {
    const tenant = practiceTenant()
    if (tenant === null) throw new Error('practice door called with the switch unset')
    if (admitted.businessId !== tenant) throw new PracticeTenantMismatch(admitted.businessId)
  }
  return {
    PracticeTenantMismatch,
    orgSettingsWriterFor: () => { throw new Error('no writes in this suite') },
    clientFor: (admitted: { businessId: string }) => {
      mockCore.reaches++
      guard(admitted)
      return jest.requireActual('./practice-door-recorded').recordedReads()
    },
    storeDaysWriterFor: () => { throw new Error('no writes in this suite') },
    auditWriterFor: () => { throw new Error('no writes in this suite') },
  }
})

import { requireBusinessAdmission } from '@/business/lib/admission'
import { readStoreCapabilities } from '@/business/lib/data'
import { settingsProps } from '@/app/[locale]/(business)/business/settings/settings-props'
import { LOGIN, STORE, TENANT } from './practice-door-recorded'

const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>
const capsRead = readStoreCapabilities as jest.MockedFunction<typeof readStoreCapabilities>

beforeEach(() => {
  mockCore.reaches = 0
  capsRead.mockClear()
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

const storePageOf = async () =>
  (await settingsProps({ locale: 'ja', store: STORE.tokyo, section: 'reserve-store-page' })).props.sections.find((x) => x.id === 'reserve-store-page')

describe('S57 P3 NIT 1 — no capabilities read for a reader the gate shuts', () => {
  it('a reader WITHOUT settings.manage: the payload is built and the capabilities read is called ZERO times', async () => {
    admission.mockResolvedValue({ userId: LOGIN.perry, email: null, displayName: null, businessId: TENANT })
    const s = await storePageOf()
    expect(mockCore.reaches).toBeGreaterThan(0) // the door is ON and the room was built from core
    expect(s?.storePage).toBeUndefined()
    expect(capsRead).toHaveBeenCalledTimes(0)
  })

  it('control: the owner (settings.manage) reaches the same read exactly once, for the lens store', async () => {
    admission.mockResolvedValue({ userId: LOGIN.owner, email: null, displayName: null, businessId: TENANT })
    const s = await storePageOf()
    expect(s?.storePage).toBeDefined()
    expect(capsRead).toHaveBeenCalledTimes(1)
    expect(capsRead).toHaveBeenCalledWith(STORE.tokyo)
  })
})
