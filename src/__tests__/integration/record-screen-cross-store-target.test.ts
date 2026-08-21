/**
 * 録音 bound target — an ADMITTED cross-store deep link keeps the customer's
 * whole IDENTITY, not just their display name (Greptile finding on PR #741,
 * 2026-08-28 audit lane).
 *
 * The A-1 fix taught the deep link to resolve the NAME business-wide, but every
 * other identity fact on the bound card still derived from the `customers`
 * array — the PICKER corpus, narrowed to the single active store. So a two-store
 * staffer pinned to 銀座 opening their 代官山 booking got the right name on a
 * stranger's card: no chart number, and a 6回券 regular framed 初回.
 *
 * The fix threads the per-id customer record buildRecordScreen ALREADY fetches
 * for the bound target (⚖ ruling ②: per-id customer reads are unscoped) as a
 * FALLBACK where the narrowed array misses. Pinned here at the shared builder
 * because both surfaces derive from it — the web sessions page and the facade
 * screens/record route — so neither can regress alone.
 *
 * Every alternative source of a "returning" verdict is switched off in the
 * harness (no karute history, no pack ledger), so these assertions can only
 * pass through the fallback under test.
 */
import { buildRecordScreen } from '@/lib/karute/record-screen'
import type { AppointmentRow } from '@/actions/appointments'
import type { CachedCustomerOption } from '@/lib/customers/cached'
import type { CustomerWithStaff } from '@/lib/customers/queries'

const NOW = new Date('2026-08-28T02:00:00.000Z') // 11:00 JST

/** A row of the store-narrowed cached list (the picker + customerFacts corpus). */
const listRow = (
  over: Partial<CachedCustomerOption> & Pick<CachedCustomerOption, 'id' | 'name'>,
): CachedCustomerOption => ({
  phone: null,
  furigana: null,
  isExistingCustomer: false,
  created_at: '2026-01-01T00:00:00.000Z',
  visitCount: 0,
  hasTicketPack: false,
  karute_number: null,
  ...over,
})

/** 銀座 — the caller's ACTIVE store, so this one IS in the narrowed array. */
const IN_STORE = listRow({ id: 'cust-ginza', name: '銀座 花子', karute_number: 7 })

const booking = (
  over: Partial<AppointmentRow> & Pick<AppointmentRow, 'id' | 'client_id'>,
): AppointmentRow => ({
  staff_profile_id: 's-me',
  start_time: '2026-08-28T03:00:00.000Z',
  duration_minutes: 60,
  title: 'カット',
  notes: null,
  karute_record_id: null,
  created_at: '2026-08-27T00:00:00.000Z',
  customers: null,
  synqed_status: 'SCHEDULED',
  source: 'MANUAL',
  status_reason: null,
  status_set_by_name: null,
  status_set_at: null,
  ...over,
})

/** The 代官山 booking: the store clamp ADMITS it (代官山 is in this staffer's
 *  assignment) and the row carries the name via the A-1 per-id name fill. */
const CROSS_STORE = booking({
  id: 'appt-daikanyama',
  client_id: 'cust-daikanyama',
  customers: { name: '代官山 太郎' },
})
const SAME_STORE = booking({
  id: 'appt-ginza',
  client_id: 'cust-ginza',
  customers: { name: '銀座 花子' },
})

/** The per-id target read (deps.getTargetCustomer). Narrow cast for the ~30
 *  core columns this assembly never touches — the record-screen suites'
 *  standing fixture convention (record-screen-recent-rows.test.ts). */
const perIdRecord = (over: Partial<CustomerWithStaff>): CustomerWithStaff =>
  ({
    id: 'cust-daikanyama',
    name: '代官山 太郎',
    created_at: '2026-02-01T00:00:00.000Z',
    notes: null,
    last_visit_at: null,
    first_visit_at: null,
    is_existing_customer: false,
    visit_count: 0,
    has_ticket_pack: false,
    karute_number: null,
    ...over,
  }) as unknown as CustomerWithStaff

async function screenFor(opts: {
  customers: CachedCustomerOption[]
  requestedAppointmentId: string
  targetCustomer: CustomerWithStaff | null
}) {
  return buildRecordScreen({
    locale: 'ja',
    now: NOW,
    requestedAppointmentId: opts.requestedAppointmentId,
    activeStaffId: 's-me',
    staffList: [{ id: 's-me', full_name: '原' }],
    customers: opts.customers,
    todayAppts: [],
    orgSettings: null,
    statusLabel: () => '',
    deps: {
      resolveExplicitAppointment: async (id) =>
        [CROSS_STORE, SAME_STORE].find((a) => a.id === id) ?? null,
      resolveWalkInCustomer: async () => null,
      getTargetCustomer: async () => opts.targetCustomer,
      getConsent: async () => null,
      // Deliberately barren: with no karute and no pack ledger, `karuteCount`
      // and an active 回数券 cannot stand in for the signals under test.
      getKaruteRecords: async () => [],
      listPacks: async () => [],
      getLifecycle: async () => ({ ok: true as const, lifecycle: null }),
    },
  })
}

describe('録音 bound target — cross-store deep link keeps its identity', () => {
  it('an admitted cross-store target gets its real chart number and returning signals', async () => {
    const customers = [IN_STORE]
    const screen = await screenFor({
      customers,
      requestedAppointmentId: 'appt-daikanyama',
      // A 回数券 regular of the other branch.
      targetCustomer: perIdRecord({
        is_existing_customer: true,
        visit_count: 6,
        has_ticket_pack: true,
        karute_number: 214,
      }),
    })

    expect(screen.nextAppointment).toMatchObject({
      id: 'appt-daikanyama',
      customerId: 'cust-daikanyama',
      customerName: '代官山 太郎',
      // The REAL core number, not a sequential index over a list this customer
      // isn't in (that index would collide with a 銀座 customer's number).
      karuteNumber: '#00214',
    })
    expect(screen.targetHasTicketPack).toBe(true)
    // 初回 framing is the field-visible symptom: a regular must never get it.
    expect(screen.brief?.isFirstTimeVisit).toBe(false)
    // The fill is for the BOUND target only — the picker corpus is untouched,
    // so the other branch's customer never enters the list surface (⚖ 8/17).
    expect(customers).toEqual([IN_STORE])
  })

  it('no per-id record → the card degrades honestly, never to an invented number', async () => {
    const screen = await screenFor({
      customers: [IN_STORE],
      requestedAppointmentId: 'appt-daikanyama',
      targetCustomer: null,
    })
    expect(screen.nextAppointment?.karuteNumber).toBeNull()
    expect(screen.targetHasTicketPack).toBe(false)
  })

  it('an in-store target still reads the picker corpus, unchanged', async () => {
    // The two sources disagree on purpose (a cached list CAN lag a fresh per-id
    // read): the array must keep winning wherever it has the customer, so no
    // existing screen shifts a single value.
    const screen = await screenFor({
      customers: [IN_STORE],
      requestedAppointmentId: 'appt-ginza',
      targetCustomer: perIdRecord({
        id: 'cust-ginza',
        name: '銀座 花子',
        is_existing_customer: true,
        visit_count: 9,
        has_ticket_pack: true,
        karute_number: 999,
      }),
    })
    expect(screen.nextAppointment?.karuteNumber).toBe('#00007')
    expect(screen.targetHasTicketPack).toBe(false)
    expect(screen.brief?.isFirstTimeVisit).toBe(true)
  })
})
