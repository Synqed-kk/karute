// Shared today's-bookings assembly (packet 08 §Build 2). The row-mapping the web
// `getAppointmentsByDate` inlined, factored onto an EXPLICIT business-scoped
// client + an injected customer-name source so the facade record-screen GET
// reproduces today's recording-target set without the cookie helpers. The web
// action delegates here (byte-identical output); it keeps owning the cookie
// store-scope + cached-name resolution and passes them in.

import { isTerminalStatus } from '@/lib/appointments/status'
import type { Appointment, SynqedClient } from '@synqed-kk/client'
import type { AppointmentRow } from '@/actions/appointments'

type ByDateClient = Pick<SynqedClient, 'appointments' | 'karuteRecords' | 'staff'>

/**
 * Fetch + map one JST calendar day's bookings to AppointmentRow[] on the given
 * client. `nameById` is the caller's customer-name source (web: the cached list;
 * facade: listAllCustomers). Terminal (CANCELLED/NO_SHOW) rows are dropped unless
 * `includeCancelled` — the recording-target picker must never auto-select one.
 */
export async function getAppointmentsByDateWithClient(
  synqed: ByDateClient,
  dateStr: string,
  opts: {
    storeId?: string
    nameById: Map<string, string>
    includeCancelled?: boolean
  },
): Promise<AppointmentRow[]> {
  const dayStartUTC = new Date(`${dateStr}T00:00:00+09:00`)
  const dayEndUTC = new Date(`${dateStr}T23:59:59.999+09:00`)
  const { storeId, nameById, includeCancelled } = opts

  const list = await synqed.appointments.list({
    from: dayStartUTC.toISOString(),
    to: dayEndUTC.toISOString(),
    page_size: 200,
    store_id: storeId ?? undefined,
  })

  const [karuteList, staffList] = await Promise.all([
    synqed.karuteRecords.list({
      from: dayStartUTC.toISOString(),
      to: dayEndUTC.toISOString(),
      page_size: 200,
      store_id: storeId ?? undefined,
    }),
    synqed.staff.list({ page_size: 200 }),
  ])

  const karuteByAppointment = new Map<string, string>()
  for (const k of karuteList.karute_records) {
    if (k.appointment_id) karuteByAppointment.set(k.appointment_id, k.id)
  }
  const profileByStaffId = new Map(
    staffList.staff
      .filter((s): s is typeof s & { user_id: string } => s.user_id != null)
      .map((s) => [s.id, s.user_id]),
  )
  const nameByStaffId = new Map(staffList.staff.map((s) => [s.id, s.name]))

  return list.appointments
    .filter((a): a is typeof a & { staff_id: string; customer_id: string } =>
      a.staff_id != null && a.customer_id != null &&
      (includeCancelled ? true : !isTerminalStatus(a.status)))
    .map((a) => {
      const statusSetBy =
        (a as typeof a & { status_set_by?: string | null }).status_set_by ?? null
      return {
        id: a.id,
        staff_profile_id: profileByStaffId.get(a.staff_id) ?? a.staff_id,
        client_id: a.customer_id,
        start_time: a.starts_at,
        duration_minutes: a.duration_minutes ?? 0,
        title: a.title,
        notes: a.notes,
        karute_record_id: karuteByAppointment.get(a.id) ?? null,
        created_at: a.created_at,
        customers: nameById.has(a.customer_id)
          ? { name: nameById.get(a.customer_id)! }
          : null,
        synqed_status: a.status,
        source: a.source,
        status_reason:
          (a as typeof a & { status_reason?: string | null }).status_reason ?? null,
        status_set_by_name: statusSetBy ? nameByStaffId.get(statusSetBy) ?? null : null,
        status_set_at:
          (a as typeof a & { status_set_at?: string | null }).status_set_at ?? null,
      }
    })
}

/**
 * Range fetch on the given client — the week/month overview's read, factored
 * out of the web `getAppointmentsInRange` action (design-parity P-B) so the
 * facade appointments-screen GET reproduces the same window without the
 * cookie helpers. Terminal (CANCELLED/NO_SHOW) bookings are dropped here —
 * the week/month card shapes carry no terminal flag, so this filter is the
 * only gate keeping tombstones out of counts/utilization/density.
 */
export async function getAppointmentsInRangeWithClient(
  synqed: Pick<SynqedClient, 'appointments'>,
  fromIso: string,
  toIso: string,
  opts: { storeId?: string } = {},
): Promise<Appointment[]> {
  const list = await synqed.appointments.list({
    from: fromIso,
    to: toIso,
    page_size: 500,
    store_id: opts.storeId ?? undefined,
  })
  return list.appointments.filter((a) => !isTerminalStatus(a.status))
}
