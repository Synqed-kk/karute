'use server'

import { revalidatePath, updateTag } from 'next/cache'
import {
  SynqedError,
  type Appointment,
  type AppointmentSource,
  type AppointmentStatus,
} from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getOrgSettings } from '@/actions/org-settings'
import {
  validateAppointmentTime,
  type AppointmentInput,
} from '@/lib/appointments'

export { validateAppointmentTime, type AppointmentInput }

export interface AppointmentRow {
  id: string
  // Holds the synqed staff id; name kept to avoid churn in calendar adapters.
  staff_profile_id: string
  client_id: string
  start_time: string
  duration_minutes: number
  title: string | null
  notes: string | null
  karute_record_id: string | null
  created_at: string
  customers: { name: string } | null
  synqed_status: AppointmentStatus
  /**
   * Origin of the booking. Bookings imported from external systems
   * (QUICKRESERVE, SALON_BOARD, etc.) start as "pending" in the UI until a
   * staff member confirms them; manually entered bookings skip that state.
   */
  source: AppointmentSource
}

export async function createAppointment(input: AppointmentInput) {
  const orgSettings = await getOrgSettings()
  const hoursError = await validateAppointmentTime(input, orgSettings?.operating_hours)
  if (hoursError) return { error: hoursError }

  const startTime = new Date(input.startTime)
  const endTime = new Date(startTime.getTime() + input.durationMinutes * 60000)

  try {
    const synqed = await getSynqedClient()
    const appt = await synqed.appointments.create({
      customer_id: input.clientId,
      staff_id: input.staffId,
      starts_at: startTime.toISOString(),
      ends_at: endTime.toISOString(),
      duration_minutes: input.durationMinutes,
      title: input.title ?? null,
      notes: input.notes ?? null,
    })
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return { id: appt.id }
  } catch (err) {
    if (err instanceof SynqedError && err.status === 409) {
      return { error: 'This time slot overlaps with an existing booking.' }
    }
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getAppointmentsByDate(dateStr: string, _tzOffsetMinutes: number = 540): Promise<AppointmentRow[]> {
  // dateStr is a JST calendar day (YYYY-MM-DD). Frame the fetch window as
  // JST midnight → next-day JST midnight by appending the +09:00 offset
  // directly; the runtime then converts to the correct UTC instants for
  // synqed-core's `from`/`to` filter. The legacy tzOffsetMinutes parameter
  // is kept for call-site compatibility but ignored — karute is JST-only.
  const dayStartUTC = new Date(`${dateStr}T00:00:00+09:00`)
  const dayEndUTC = new Date(`${dateStr}T23:59:59.999+09:00`)

  try {
    const synqed = await getSynqedClient()
    const list = await synqed.appointments.list({
      from: dayStartUTC.toISOString(),
      to: dayEndUTC.toISOString(),
      page_size: 200,
    })

    // Customer names come from the already-cached tenant customer list (60s
    // TTL per tenant), so on warm requests there's no extra HTTP roundtrip.
    // Previously this fanned out N parallel customers.get(id) calls per page
    // load — visibly slow once the day had a handful of unique customers.
    const [cachedCustomers, karuteList] = await Promise.all([
      getCachedCustomerList(),
      synqed.karuteRecords.list({
        from: dayStartUTC.toISOString(),
        to: dayEndUTC.toISOString(),
        page_size: 200,
      }),
    ])
    const nameById = new Map(cachedCustomers.map((c) => [c.id, c.name]))
    const karuteByAppointment = new Map<string, string>()
    for (const k of karuteList.karute_records) {
      if (k.appointment_id) karuteByAppointment.set(k.appointment_id, k.id)
    }

    return list.appointments.map((a) => ({
      id: a.id,
      staff_profile_id: a.staff_id,
      client_id: a.customer_id,
      start_time: a.starts_at,
      duration_minutes: a.duration_minutes ?? 0,
      title: a.title,
      notes: a.notes,
      karute_record_id: karuteByAppointment.get(a.id) ?? null,
      created_at: a.created_at,
      customers: nameById.has(a.customer_id) ? { name: nameById.get(a.customer_id)! } : null,
      synqed_status: a.status,
      source: a.source,
    }))
  } catch {
    return []
  }
}

export async function getAppointmentsInRange(
  fromIso: string,
  toIso: string,
): Promise<Appointment[]> {
  try {
    const synqed = await getSynqedClient()
    const list = await synqed.appointments.list({
      from: fromIso,
      to: toIso,
      page_size: 500,
    })
    return list.appointments
  } catch {
    return []
  }
}

export async function deleteAppointment(appointmentId: string) {
  try {
    const synqed = await getSynqedClient()
    await synqed.appointments.delete(appointmentId)
    revalidatePath('/dashboard')
    updateTag('dashboard')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updateAppointment(
  appointmentId: string,
  updates: { staffId?: string; startTime?: string; durationMinutes?: number },
) {
  try {
    const synqed = await getSynqedClient()
    const patch: {
      staff_id?: string
      starts_at?: string
      ends_at?: string
      duration_minutes?: number
    } = {}

    if (updates.staffId) {
      patch.staff_id = updates.staffId
    }
    if (updates.startTime) patch.starts_at = updates.startTime
    if (updates.durationMinutes) patch.duration_minutes = updates.durationMinutes

    // If start + duration change, server needs both starts_at and ends_at
    if (updates.startTime && updates.durationMinutes) {
      const start = new Date(updates.startTime)
      patch.ends_at = new Date(start.getTime() + updates.durationMinutes * 60000).toISOString()
    }

    await synqed.appointments.update(appointmentId, patch)
    revalidatePath('/appointments')
    updateTag('dashboard')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
