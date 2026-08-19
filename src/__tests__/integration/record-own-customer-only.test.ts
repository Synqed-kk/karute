/**
 * 録音 implicit target — OWN bookings only (Liam ruling 8/19, field report).
 *
 * The centre record button used to fall through to `findFirst(list)` when the
 * signed-in staff had no candidate of their own, silently auto-binding ANOTHER
 * stylist's customer. That fallback is gone: the implicit resolution reads
 * `myRows` only, so no own booking → NO target at all (the screen then asks
 * explicitly). The EXPLICIT entries (?appointmentId / ?customerId) are
 * deliberate acts and still bind any booking the staffer opened.
 */
import { buildRecordScreen } from '@/lib/karute/record-screen'
import type { AppointmentRow } from '@/actions/appointments'
import type { CustomerWithStaff } from '@/lib/customers/queries'

const NOW = new Date('2026-08-19T02:00:00.000Z') // 11:00 JST

const appt = (over: Partial<AppointmentRow> & Pick<AppointmentRow, 'id'>): AppointmentRow =>
  ({
    staff_profile_id: 's-other',
    client_id: `cust-${over.id}`,
    start_time: '2026-08-19T03:00:00.000Z',
    duration_minutes: 60,
    title: 'カット',
    notes: null,
    karute_record_id: null,
    created_at: '2026-08-18T00:00:00.000Z',
    customers: { name: `客-${over.id}` },
    ...over,
  }) as unknown as AppointmentRow

const MINE = appt({ id: 'a-mine', staff_profile_id: 's-me', client_id: 'c-mine' })
const THEIRS = appt({
  id: 'a-theirs',
  staff_profile_id: 's-other',
  client_id: 'c-theirs',
  start_time: '2026-08-19T01:30:00.000Z', // earlier → wins any "first" ordering
})

async function screenFor(
  todayAppts: AppointmentRow[],
  extra: { requestedAppointmentId?: string; activeStaffId?: string | null } = {},
) {
  return buildRecordScreen({
    locale: 'ja',
    now: NOW,
    activeStaffId: 's-me',
    staffList: [
      { id: 's-me', full_name: '原' },
      { id: 's-other', full_name: '佐藤' },
    ],
    customers: [],
    todayAppts,
    orgSettings: null,
    statusLabel: () => '',
    deps: {
      resolveExplicitAppointment: async (id) =>
        todayAppts.find((a) => a.id === id) ?? null,
      resolveWalkInCustomer: async () => null as CustomerWithStaff | null,
      getTargetCustomer: async () => null,
      getConsent: async () => null,
      getKaruteRecords: async () => [],
      listPacks: async () => [],
      getLifecycle: async () => ({ ok: true as const, lifecycle: null }),
    },
    ...extra,
  })
}

describe('録音 implicit target resolution — own customers only', () => {
  it('t1: staff WITH an own booking still gets it auto-picked (unchanged)', async () => {
    const screen = await screenFor([THEIRS, MINE])
    expect(screen.nextAppointment).toMatchObject({
      id: 'a-mine',
      customerId: 'c-mine',
    })
  })

  it('t2: staff with NO own booking gets NO target, never a colleague`s', async () => {
    const screen = await screenFor([THEIRS])
    expect(screen.nextAppointment).toBeNull()
    // Everything the empty state hangs off must be empty too — a null target
    // with a populated brief/consent would leak the colleague's customer.
    expect(screen.brief).toBeNull()
    expect(screen.briefInputs).toBeNull()
    expect(screen.consentDate).toBeNull()
    expect(screen.recentRecordings).toEqual([])
  })

  it('t3: an EXPLICIT ?appointmentId to a colleague`s booking still binds, with the banner', async () => {
    const screen = await screenFor([THEIRS], { requestedAppointmentId: 'a-theirs' })
    expect(screen.nextAppointment).toMatchObject({
      id: 'a-theirs',
      customerId: 'c-theirs',
      bookedUnderOtherStaff: true,
    })
  })

  it('a caller with no staff identity keeps the day`s list as its own set', async () => {
    const screen = await screenFor([THEIRS], { activeStaffId: null })
    expect(screen.nextAppointment).toMatchObject({ id: 'a-theirs' })
  })
})
