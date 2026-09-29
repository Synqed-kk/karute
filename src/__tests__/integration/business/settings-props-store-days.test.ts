// ⚖ PKT-S30 F3 (m12) + P3-10 — settings-props on the LIVE branch: the page is assembled exactly as the
// route does it (SettingsPage → settingsProps → the door) on the recorded Dev Salon answer set, with
// the store-days reads stubbed; the returned <SettingsScreen> element's props are read directly.
// Prior art: opus-read-1/scripts/screen-attack.test.tsx (its mock header, reused).
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
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
  const never = () => { throw new Error('settings-props never writes') }
  return { PracticeTenantMismatch, orgSettingsWriterFor: never, storeDaysWriterFor: never, auditWriterFor: never, clientFor: (admitted: { businessId: string }) => (guard(admitted), stub.reads()) }
})

import type { ReactElement } from 'react'
import { requireBusinessAdmission } from '@/business/lib/admission'
import SettingsPage from '@/app/[locale]/(business)/business/settings/page'
import type { SettingsBlock, SettingsProps } from '@/business/lib/settings'
import type { CoreReads } from '@/business/lib/practice-door/core-reach'
import { CARD, LOGIN, STORE, TENANT, recordedReads } from './practice-door-recorded'
import { storeDaysLockedNote } from '@/app/[locale]/(business)/business/settings/settings-props'
import { READ_FAILURE_LINE, READ_ONLY_NOTE } from '@/business/lib/data'

type CD = { id: string; store_id: string; date: string; reason: string | null; created_by: string | null; created_at: string }
const C1: CD = { id: 'c1', store_id: STORE.tokyo, date: '2026-10-08', reason: '店内研修（テスト）', created_by: null, created_at: 'x' }
const C2: CD = { id: 'c2', store_id: STORE.tokyo, date: '2026-11-10', reason: '棚卸し', created_by: null, created_at: 'x' }
const FAIL_LINE = 'いまは予定を読み込めないため、時間をおいてページを再読み込みしてください。'
const BADGE = '臨時休業より優先'

const stub = {
  getThrows: false,
  listThrows: false,
  asAdmin: false,
  grantThrows: false,
  reads(): CoreReads {
    const base = recordedReads({ closedDays: { [STORE.tokyo]: [C1, C2] }, hqGranted: false })
    return {
      ...base,
      // ⚖ PKT-S32 R14 — the OWNER's login answered by core as an ADMIN (settings.manage + viewAll, no grant)
      answerSheet: async (id: string) => {
        const s = await base.answerSheet(id)
        return stub.asAdmin && id === CARD.owner ? { ...s, role: 'manager', coarse_role: 'ADMIN', capabilities: ['settings.manage', 'stores.viewAll'], visible_store_ids: null } : s
      },
      businessGrantsCheck: async (id: string) => {
        if (stub.grantThrows) throw new Error('core outage (grants)')
        return base.businessGrantsCheck(id)
      },
      storePolicyGet: async (id: string) => {
        if (stub.getThrows) throw new Error('core outage (get)')
        const p = await base.storePolicyGet(id)
        return { ...p, special_open_days: [{ date: '2026-11-10', open: '10:00', close: '19:00' }, { date: '2026-10-20', open: '10:00', close: '19:00' }] }
      },
      storePolicyListClosedDays: async (_id: string, range?: { from?: string }) => {
        if (stub.listThrows) throw new Error('core outage (list)')
        return { closed_days: [C1, C2].filter((c) => !range?.from || c.date >= range.from) }
      },
    }
  },
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] }).setSystemTime(new Date('2026-09-29T03:00:00Z'))
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  stub.getThrows = false
  stub.listThrows = false
  stub.asAdmin = false
  stub.grantThrows = false
  ;(requireBusinessAdmission as jest.Mock).mockResolvedValue({ userId: LOGIN.owner, email: null, businessId: TENANT })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

async function blocks(): Promise<Record<string, SettingsBlock>> {
  const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.tokyo, section: 'store-hours' }) })) as ReactElement<SettingsProps>
  const sec = el.props.sections.find((s) => s.id === 'store-hours')!
  return Object.fromEntries(sec.blocks.map((b) => [b.id, b]))
}

describe('F3 — settings-props, LIVE store-days blocks', () => {
  it('both reads land: both blocks carry core’s rows; the badge is on 2026-11-10 (a closure), none on 10-20', async () => {
    const b = await blocks()
    expect(b['store-hours.closures'].collection!.items.map((r) => r.date)).toEqual(['2026-10-08', '2026-11-10'])
    const special = b['store-hours.special-open'].specialDays!.items
    expect(special.map((s) => [s.date, s.badge])).toEqual([['2026-10-20', null], ['2026-11-10', BADGE]])
  })
  it('both reads fail: each block shows the failure line and NO add controls', async () => {
    stub.getThrows = true
    stub.listThrows = true
    const b = await blocks()
    expect(b['store-hours.closures'].collection).toBeNull()
    expect(b['store-hours.closures'].facts).toContain(FAIL_LINE)
    expect(b['store-hours.special-open'].specialDays).toBeNull()
    expect(b['store-hours.special-open'].facts).toContain(FAIL_LINE)
  })
  it('P3-10 — only the closures read fails: 臨時休業 shows its failure line, 特別営業日 still shows its rows', async () => {
    stub.listThrows = true
    const b = await blocks()
    expect(b['store-hours.closures'].collection).toBeNull()
    expect(b['store-hours.closures'].facts).toContain(FAIL_LINE)
    expect(b['store-hours.special-open'].specialDays!.items.map((s) => s.date)).toEqual(['2026-10-20', '2026-11-10'])
    expect(b['store-hours.special-open'].facts).not.toContain(FAIL_LINE)
  })
  it('P3-10 — only the policy read fails: 特別営業日 shows its failure line, 臨時休業 still shows its rows', async () => {
    stub.getThrows = true
    const b = await blocks()
    expect(b['store-hours.special-open'].specialDays).toBeNull()
    expect(b['store-hours.special-open'].facts).toContain(FAIL_LINE)
    expect(b['store-hours.closures'].collection!.items.map((r) => r.date)).toEqual(['2026-10-08', '2026-11-10'])
  })
})

// ⚖ PKT-S31 R9 — the grant check's three answers, each mapped to exactly one line (no new copy).
describe('R9 — store-days write state → the line shown instead of add/remove', () => {
  it("'writable' → no line (the controls)", () => expect(storeDaysLockedNote('writable')).toBeNull())
  it("'read-only' → the permission line", () => expect(storeDaysLockedNote('read-only')).toBe('変更には本部の権限が必要です。'))
  it("'unknown' → the section's own read-failure line, never the permission line", () => expect(storeDaysLockedNote('unknown')).toBe(FAIL_LINE))
  it('the page hands the mapped line to the screen: an OWNER (core’s requireHqAdmin passes by role) → null', async () => {
    const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.tokyo, section: 'store-hours' }) })) as ReactElement<{ saveStoreDays?: { lockedNote: string | null } }>
    expect(el.props.saveStoreDays).toMatchObject({ storeId: STORE.tokyo, lockedNote: null })
  })
})

// ⚖ PKT-S32 R14 — the page's mapping for the two locked actors (strings from the source, never retyped).
describe('R14 — the page maps the locked actors’ line into saveStoreDays.lockedNote', () => {
  const lockedNote = async () => {
    const el = (await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store: STORE.tokyo, section: 'store-hours' }) })) as ReactElement<{ saveStoreDays?: { storeId: string; lockedNote: string | null } }>
    expect(el.props.saveStoreDays).toBeDefined()
    expect(el.props.saveStoreDays!.storeId).toBe(STORE.tokyo)
    return el.props.saveStoreDays!.lockedNote
  }
  it('the two lines are real and distinct', () => {
    expect(READ_ONLY_NOTE.length).toBeGreaterThan(0)
    expect(READ_FAILURE_LINE.length).toBeGreaterThan(0)
    expect(READ_ONLY_NOTE).not.toBe(READ_FAILURE_LINE)
  })
  it('a non-OWNER without the HQ grant → the read-only line', async () => {
    stub.asAdmin = true
    expect(await lockedNote()).toBe(READ_ONLY_NOTE)
  })
  it('the grant check throws → the section’s own failure line (unknown), never the read-only line', async () => {
    stub.asAdmin = true
    stub.grantThrows = true
    const note = await lockedNote()
    expect(note).toBe(READ_FAILURE_LINE)
    expect(note).not.toBe(READ_ONLY_NOTE)
  })
})

describe('B2 act 1 honest lines — markLine rides the sample mark', () => {
  const S1 = 'サンプルのため、ここで変更しても店舗の設定としては保存されません。実データがつながると、ここから設定できます。'
  const SAMPLE_IDS = ['store-hours.info', 'store-hours.hours', 'store-hours.ops']
  it('door ON: the three sample blocks carry mark + markLine; the live blocks carry neither', async () => {
    const b = await blocks()
    for (const id of SAMPLE_IDS) {
      expect(b[id].sample).toBeDefined()
      expect(b[id].markLine).toBe(S1)
    }
    for (const id of ['store-hours.closures', 'store-hours.special-open']) {
      expect(b[id].sample).toBeUndefined()
      expect(b[id].markLine).toBeUndefined()
    }
  })
  it('door OFF: no block carries a markLine', async () => {
    delete process.env.BUSINESS_PRACTICE_TENANT
    const b = await blocks()
    for (const blk of Object.values(b)) expect(blk.markLine).toBeUndefined()
  })
})
