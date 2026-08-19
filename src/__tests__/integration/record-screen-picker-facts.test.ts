/**
 * buildRecordScreen → customerFacts (picker dialog v2, 8/19 mock).
 *
 * The dialog's chips are NOT derived in the component — they are one
 * server-built row per customer, so the 残5/6 in the picker is the same 残5/6
 * the 予約 agenda shows. This pins that derivation against the two injected
 * bulk maps (the SAME ones the appointments screen takes), plus the two things
 * that decide whether facts exist at all:
 *
 *   · the no-target gate — with a booking bound the picker is unreachable, so
 *     the whole-tenant array is not built,
 *   · graceful degradation — no maps injected → rows still get karute # / 新規,
 *     never a wrong value.
 *
 * The 新規 verdict must come from isReturningCustomer (the one chopstick), so a
 * QR regular with zero karute is NOT 新規 — that exact mislabel is what the
 * shared helper exists to prevent.
 */
import { buildRecordScreen } from '@/lib/karute/record-screen'
import { assignStaffColors } from '@/lib/staff-colors'
import type { AppointmentRow } from '@/actions/appointments'
import type { CustomerWithStaff } from '@/lib/customers/queries'
import type { CustomerEnrichment } from '@/lib/customers/list-enrich'

const NOW = new Date('2026-08-19T02:00:00.000Z') // 11:00 JST

const STAFF = [
  { id: 's-me', full_name: '原' },
  { id: 's-other', full_name: '佐藤' },
]

const CUSTOMERS = [
  // A regular: QR visit history + a live 回数券, one karute on file.
  {
    id: 'c-regular',
    name: '高橋 由美',
    phone: null,
    furigana: null,
    isExistingCustomer: true,
    created_at: '2026-01-01T00:00:00.000Z',
    visitCount: 6,
    hasTicketPack: true,
    karute_number: 214,
  },
  // Brand new: no history anywhere.
  {
    id: 'c-fresh',
    name: '高田 真央',
    phone: null,
    furigana: null,
    isExistingCustomer: false,
    created_at: '2026-08-01T00:00:00.000Z',
    visitCount: 0,
    hasTicketPack: false,
    karute_number: 219,
  },
  // A QR regular with ZERO karute — the mislabel isReturningCustomer prevents.
  {
    id: 'c-qr',
    name: '高木 沙耶',
    phone: null,
    furigana: null,
    isExistingCustomer: false,
    created_at: '2026-02-01T00:00:00.000Z',
    visitCount: 4,
    hasTicketPack: false,
    karute_number: 98,
  },
]

const EMPTY_ENRICH: CustomerEnrichment = {
  totalKarute: 0,
  lastVisitIso: null,
  pastAppointmentCount: 0,
  lastVisitService: null,
  bookingStaffId: null,
  nextAppointmentIso: null,
  firstVisitIso: null,
  datedVisitCount: 0,
  noShowCount: 0,
}

const ENRICHMENT = new Map<string, CustomerEnrichment>([
  [
    'c-regular',
    {
      ...EMPTY_ENRICH,
      totalKarute: 3,
      lastVisitIso: '2026-08-02T03:00:00.000Z', // 12:00 JST, same year
      lastVisitService: 'カット＋カラー',
      bookingStaffId: 's-other',
      pastAppointmentCount: 5,
    },
  ],
  ['c-fresh', EMPTY_ENRICH],
  ['c-qr', { ...EMPTY_ENRICH, lastVisitIso: '2025-12-24T03:00:00.000Z' }],
])

const PACK_USAGE = new Map([['c-regular', { remaining: 5, size: 10 }]])

const theirBooking: AppointmentRow = {
  id: 'a-theirs',
  staff_profile_id: 's-other',
  client_id: 'c-regular',
  start_time: '2026-08-19T03:00:00.000Z',
  duration_minutes: 60,
  title: 'カット',
  notes: null,
  karute_record_id: null,
  created_at: '2026-08-18T00:00:00.000Z',
  customers: { name: '高橋 由美' },
} as unknown as AppointmentRow

type ScreenInput = Parameters<typeof buildRecordScreen>[0]

function screen(over: Partial<ScreenInput> = {}) {
  return buildRecordScreen({
    locale: 'ja',
    now: NOW,
    activeStaffId: 's-me',
    staffList: STAFF,
    customers: CUSTOMERS,
    todayAppts: [theirBooking],
    orgSettings: null,
    statusLabel: () => '',
    enrichment: ENRICHMENT,
    packUsage: PACK_USAGE,
    deps: {
      resolveExplicitAppointment: async (id) => (id === 'a-theirs' ? theirBooking : null),
      resolveWalkInCustomer: async () => null as CustomerWithStaff | null,
      getTargetCustomer: async () => null,
      getConsent: async () => null,
      getKaruteRecords: async () => [],
      listPacks: async () => [],
      getLifecycle: async () => ({ ok: true as const, lifecycle: null }),
    },
    ...over,
  })
}

describe('buildRecordScreen — picker customerFacts', () => {
  it('derives every picker chip from the injected bulk maps', async () => {
    // No own booking → no target → the picker is reachable → facts are built.
    const { customerFacts } = await screen()
    const by = new Map(customerFacts.map((f) => [f.id, f]))

    expect(by.get('c-regular')).toEqual({
      id: 'c-regular',
      karuteNumber: '#00214',
      hasKarute: true,
      pack: { remaining: 5, size: 10 },
      lastVisitDate: '8月2日',
      lastVisitService: 'カット＋カラー',
      staffName: '佐藤',
      staffColorKey: assignStaffColors(['s-me', 's-other']).get('s-other')?.key,
    })

    // Brand new: the 新規 flag, and NOTHING else invented.
    expect(by.get('c-fresh')).toEqual({
      id: 'c-fresh',
      karuteNumber: '#00219',
      isNew: true,
    })

    // QR regular with zero karute is NOT 新規 (isReturningCustomer's whole
    // point), and a prior-year visit keeps its year rather than reading as
    // "last December" of this year.
    const qr = by.get('c-qr')
    expect(qr?.isNew).toBeUndefined()
    expect(qr?.hasKarute).toBeUndefined()
    expect(qr?.lastVisitDate).toBe('2025年12月24日')
  })

  it('hangs the booking rows off the same facts via customerId', async () => {
    const { nearbyBookings } = await screen()
    expect(nearbyBookings[0].customerId).toBe('c-regular')
  })

  it('builds NOTHING when a target is bound (the picker cannot open)', async () => {
    // An EXPLICIT ?appointmentId binds the colleague's booking — with a target
    // on screen the dialog has no entry point, so the array stays empty.
    const bound = await screen({ requestedAppointmentId: 'a-theirs' })
    expect(bound.nextAppointment?.id).toBe('a-theirs')
    expect(bound.customerFacts).toEqual([])
  })

  it('degrades to karute # + 新規 when neither bulk map is injected', async () => {
    const { customerFacts } = await screen({ enrichment: undefined, packUsage: undefined })
    const by = new Map(customerFacts.map((f) => [f.id, f]))
    expect(by.get('c-regular')).toEqual({ id: 'c-regular', karuteNumber: '#00214' })
    expect(by.get('c-fresh')).toEqual({ id: 'c-fresh', karuteNumber: '#00219', isNew: true })
  })
})
