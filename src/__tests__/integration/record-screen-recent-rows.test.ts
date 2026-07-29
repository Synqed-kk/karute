/**
 * 録音 page — 最近の録音 rows must surface the record's real 施術メニュー and
 * recording minutes (7/29 field report: the mapper hardcoded '—' for both,
 * so even records WITH the data rendered dashes). Records that predate the
 * columns keep the honest '—' fallbacks.
 */
import { buildRecordScreen } from '@/lib/karute/record-screen'
import type { KaruteRecord } from '@synqed-kk/client'
import type { CustomerWithStaff } from '@/lib/customers/queries'

const record = (over: Partial<KaruteRecord>): KaruteRecord =>
  ({
    id: 'kr-1',
    created_at: '2026-07-28T07:00:00.000Z',
    entries: [],
    entry_count: 0,
    ...over,
  }) as unknown as KaruteRecord

const walkInCustomer = {
  id: 'cust-1',
  name: 'リエム 代表',
} as unknown as CustomerWithStaff

async function recentRowsFor(karute: KaruteRecord[]) {
  const result = await buildRecordScreen({
    locale: 'ja',
    now: new Date('2026-07-29T03:00:00.000Z'),
    requestedCustomerId: 'cust-1',
    activeStaffId: 's1',
    staffList: [{ id: 's1', full_name: 'Liam' }],
    customers: [],
    todayAppts: [],
    orgSettings: null,
    statusLabel: () => '',
    deps: {
      resolveExplicitAppointment: async () => null,
      resolveWalkInCustomer: async () => walkInCustomer,
      getTargetCustomer: async () => null,
      getConsent: async () => null,
      getKaruteRecords: async () => karute,
      listPacks: async () => [],
      getLifecycle: async () => ({ ok: true as const, lifecycle: null }),
    },
  })
  return result.recentRecordings
}

describe('録音 page recent-recordings rows', () => {
  it('surfaces the record`s real menu + minutes', async () => {
    const rows = await recentRowsFor([
      record({ service: 'VIP施術', duration_minutes: 51 } as Partial<KaruteRecord>),
    ])
    expect(rows[0]).toMatchObject({ service: 'VIP施術', durationLabel: '51分' })
  })

  it('keeps honest dashes for records that predate the columns', async () => {
    const rows = await recentRowsFor([
      record({ service: null, duration_minutes: null } as Partial<KaruteRecord>),
    ])
    expect(rows[0]).toMatchObject({ service: '—', durationLabel: '—' })
  })
})
