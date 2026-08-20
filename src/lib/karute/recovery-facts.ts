// Recording-DAY facts for the recovery banner (PR-B1, D2 + D4).
//
// The banner's 保存先 picker may offer ONLY customers booked on the day the
// audio was RECORDED (plus the take's originally-bound customer, pinned) —
// structural anti-fraud (⚖ 8/21 doctrine ⑥). The record screen's own
// nearbyBookings are TODAY's, and a take lives up to its 24 h TTL, so the day
// is a parameter here and nowhere else.
//
// Identity-agnostic, same discipline as record-screen.ts: everything rides an
// already business-scoped client (web: getSynqedClient's cookie client; facade:
// newSynqedClient(businessId)), so ONE derivation serves both worlds and the
// phones get it without a re-bake. Store scope is the caller's `storeId` —
// the store-isolation law is unchanged here, only the DATE moves.
//
// Reads (all bulk — no N+1): the day's bookings (the shared by-date assembly),
// the business customer list (names + karute numbers), the whole-tenant 回数券
// usage aggregate, and ONE redemption-history page. The last one is the same
// read the auto-burn cron's guards use.

import { assignStaffColors } from '@/lib/staff-colors'
import {
  assignSequentialKaruteNumbers,
  deriveFamilyInitials,
} from '@/lib/customers/identity'
import { getAppointmentsByDateWithClient } from '@/lib/appointments/by-date'
import { listAllCustomers } from '@/lib/customers/list-all'
import { listAllPackUsageWithClient } from '@/lib/packs/store'
import { ymdInJst } from '@/lib/date/jst'
import type { SynqedClient } from '@synqed-kk/client'
import type { RecordTargetBooking } from '@/components/karute/redesign/record/RecordingTargetCard'

export type RecoveryFactsClient = Pick<
  SynqedClient,
  'appointments' | 'karuteRecords' | 'staff' | 'customers' | 'packs'
>

export interface RecoveryDayFacts {
  /** The JST day these facts describe (echoed back so a client can't paint a
   *  list under the wrong date heading). */
  date: string
  /** A-5: the read FAILED (or was refused) — this is not a quiet day, it is an
   *  unknown one. An EXPLICIT discriminant, never inferred from emptiness: a
   *  salon with no bookings that day and a salon whose read 502'd produce the
   *  identical empty arrays, and only one of them may let a save proceed. */
  unavailable?: true
  /** Bookings on that day — the picker rows (terminal rows already dropped by
   *  the shared by-date assembly). */
  bookings: RecordTargetBooking[]
  /** Active 回数券 per relevant customer — the picker row's 残n/m pill AND the
   *  burn target for a recovery save. `packId` is the SAME FIFO pick the money
   *  path uses (first active counted pack with sessions left); null when the
   *  customer's packs are all spent. Only customers who actually hold one get
   *  a row — a row of nulls is pure wire weight. */
  packs: { customerId: string; packId: string | null; remaining: number; size: number }[]
  /** Which of that day's burns already happened. `null` = the history read
   *  FAILED: 消化 state is then UNKNOWN and the banner must stay silent rather
   *  than claim 未処理 (F7 — derived truth or nothing). */
  redeemed: { appointmentIds: string[]; customerIds: string[] } | null
}

/** Live-redemption lookback, in JST days, for the day being inspected. Same
 *  narrow floor autoBurn's historySince uses (one day back), for the same
 *  reason: an unbounded history read is a silent-timeout money hole. */
function historySince(dateYmd: string): string {
  return ymdInJst(new Date(Date.parse(`${dateYmd}T00:00:00+09:00`) - 86_400_000))
}

export async function buildRecoveryDayFacts(
  synqed: RecoveryFactsClient,
  input: {
    /** JST yyyy-mm-dd of the RECORDING (derived from the take's startedAt). */
    dateYmd: string
    /** Active store — the same clamp every other recording surface applies. */
    storeId?: string
    /**
     * Customers to include even with no booking that day: the take's ORIGINAL
     * binding (pinned atop the picker, ⚖ doctrine ⑥) AND the CURRENT
     * destination, which after a search re-point may be neither pinned nor
     * booked. Both get a 回数券 row, or the banner and the save flow read
     * "no pack" for a customer who has one and the burn question is silently
     * dropped (F-1). Ids the client already legitimately holds — no new tier.
     */
    pinnedCustomerIds?: (string | null | undefined)[]
    /** reservation.status label resolver (getTranslations), kept a plain fn so
     *  this module stays loadable by both builds + jest. */
    statusLabel: (key: 'in_session' | 'completed' | 'booked') => string
  },
): Promise<RecoveryDayFacts> {
  const { dateYmd, storeId, pinnedCustomerIds = [], statusLabel } = input

  const customerRes = await listAllCustomers(synqed as SynqedClient, {
    sort_by: 'created_at',
    sort_order: 'asc',
  })
  const customers = customerRes.customers
  const nameById = new Map(customers.map((c) => [c.id, c.name]))
  const karuteNumberByClientId = assignSequentialKaruteNumbers(customers)

  // The three remaining reads are independent — fire them together. Both
  // best-effort reads degrade to "no detail", never to a wrong number; the
  // history read is TRI-STATE (see RecoveryDayFacts.redeemed).
  const [appts, staffRes, packUsage, history] = await Promise.all([
    getAppointmentsByDateWithClient(synqed, dateYmd, { storeId, nameById }),
    synqed.staff.list({ page_size: 200 }).catch(() => ({ staff: [] })),
    listAllPackUsageWithClient(synqed as SynqedClient).catch(() => null),
    synqed.packs
      .listRecentRedemptions(historySince(dateYmd))
      .then((rows) =>
        rows.map((r) => ({
          appointmentId: r.appointment_id,
          customerId: r.customer_id,
          on: r.redeemed_on.slice(0, 10),
        })),
      )
      .catch(() => null),
  ])

  const staffList = staffRes.staff
  const staffNameById = new Map(staffList.map((s) => [s.id, s.name]))
  const staffColors = assignStaffColors(staffList.map((s) => s.id))

  const bookings: RecordTargetBooking[] = [...appts]
    .sort((a, b) => (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0))
    .map((a) => {
      const start = new Date(a.start_time)
      const end = new Date(start.getTime() + a.duration_minutes * 60_000)
      // The recording day is normally PAST, so 施術中 is meaningless here: a
      // booking either has its karute (記録済) or it doesn't.
      const isDone = !!a.karute_record_id
      const customerName = a.customers?.name ?? nameById.get(a.client_id) ?? 'Unknown'
      return {
        id: a.id,
        start: hhmm(start),
        end: hhmm(end),
        customer: customerName,
        customerId: a.client_id,
        initials: deriveFamilyInitials(customerName),
        staffId: a.staff_profile_id,
        staffColorKey: a.staff_profile_id
          ? (staffColors.get(a.staff_profile_id)?.key ?? null)
          : null,
        karute: karuteNumberByClientId.get(a.client_id) ?? null,
        service: a.title ?? '—',
        staff: a.staff_profile_id ? (staffNameById.get(a.staff_profile_id) ?? '—') : '—',
        statusKey: isDone ? ('done' as const) : ('booked' as const),
        statusLabel: isDone ? statusLabel('completed') : statusLabel('booked'),
      }
    })

  // ONE fact row per BOOKED customer that actually holds a pack — the picker
  // rows read `pack` and nothing else here, so a row of nulls would be pure
  // wire weight.
  const packs: RecoveryDayFacts['packs'] = []
  const seen = new Set<string>()
  for (const cid of [...pinnedCustomerIds, ...bookings.map((b) => b.customerId)]) {
    if (!cid || seen.has(cid)) continue
    seen.add(cid)
    const usage = packUsage?.get(cid)
    if (usage && usage.size > 0) {
      packs.push({
        customerId: cid,
        packId: usage.firstPackId ?? null,
        remaining: usage.remaining,
        size: usage.size,
      })
    }
  }

  return {
    date: dateYmd,
    bookings,
    packs,
    redeemed: history
      ? {
          appointmentIds: history
            .filter((r): r is typeof r & { appointmentId: string } => !!r.appointmentId)
            .map((r) => r.appointmentId),
          customerIds: history.filter((r) => r.on === dateYmd).map((r) => r.customerId),
        }
      : null,
  }
}

function hhmm(d: Date): string {
  // Always JST — the server is UTC, so getHours() would paint UTC on the row.
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })
}
