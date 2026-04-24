'use server'

import { revalidatePath } from 'next/cache'
import { SynqedError } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { getOrgSettings } from '@/actions/org-settings'
import {
  validateAppointmentTime,
  type AppointmentInput,
} from '@/lib/appointments'

export { validateAppointmentTime, type AppointmentInput }

export interface AppointmentRow {
  id: string
  staff_profile_id: string
  client_id: string
  start_time: string
  duration_minutes: number
  title: string | null
  notes: string | null
  karute_record_id: string | null
  created_at: string
  customers: { name: string } | null
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
      staff_id: input.staffProfileId,
      starts_at: startTime.toISOString(),
      ends_at: endTime.toISOString(),
      duration_minutes: input.durationMinutes,
      title: input.title ?? null,
      notes: input.notes ?? null,
    })
    revalidatePath('/dashboard')
    return { id: appt.id }
  } catch (err) {
    if (err instanceof SynqedError && err.status === 409) {
      return { error: 'This time slot overlaps with an existing booking.' }
    }
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getAppointmentsByDate(dateStr: string, tzOffsetMinutes: number = 0): Promise<AppointmentRow[]> {
  const dayStartUTC = new Date(`${dateStr}T00:00:00Z`)
  dayStartUTC.setUTCMinutes(dayStartUTC.getUTCMinutes() + tzOffsetMinutes)
  const dayEndUTC = new Date(`${dateStr}T23:59:59Z`)
  dayEndUTC.setUTCMinutes(dayEndUTC.getUTCMinutes() + tzOffsetMinutes)

  try {
    const synqed = await getSynqedClient()
    const list = await synqed.appointments.list({
      from: dayStartUTC.toISOString(),
      to: dayEndUTC.toISOString(),
      page_size: 200,
    })

    const uniqueCustomerIds = Array.from(new Set(list.appointments.map((a) => a.customer_id)))
    const [customers, karuteList] = await Promise.all([
      Promise.all(uniqueCustomerIds.map((id) => synqed.customers.get(id).catch(() => null))),
      synqed.karuteRecords.list({
        from: dayStartUTC.toISOString(),
        to: dayEndUTC.toISOString(),
        page_size: 500,
      }),
    ])
    const nameById = new Map(
      customers.filter((c): c is NonNullable<typeof c> => c != null).map((c) => [c.id, c.name]),
    )
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
    }))
  } catch {
    return []
  }
}

export async function deleteAppointment(appointmentId: string) {
  try {
    const synqed = await getSynqedClient()
    await synqed.appointments.delete(appointmentId)
    revalidatePath('/dashboard')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function updateAppointment(
  appointmentId: string,
  updates: { staffProfileId?: string; startTime?: string; durationMinutes?: number },
) {
  try {
    const synqed = await getSynqedClient()
    const patch: {
      staff_id?: string
      starts_at?: string
      ends_at?: string
      duration_minutes?: number
    } = {}

    if (updates.staffProfileId) patch.staff_id = updates.staffProfileId
    if (updates.startTime) patch.starts_at = updates.startTime
    if (updates.durationMinutes) patch.duration_minutes = updates.durationMinutes

    // If start + duration change, server needs both starts_at and ends_at
    if (updates.startTime && updates.durationMinutes) {
      const start = new Date(updates.startTime)
      patch.ends_at = new Date(start.getTime() + updates.durationMinutes * 60000).toISOString()
    }

    await synqed.appointments.update(appointmentId, patch)
    revalidatePath('/appointments')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
