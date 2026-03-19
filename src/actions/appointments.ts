'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getOrgSettings } from '@/actions/org-settings'
import {
  formatMinuteOfDay,
  normalizeOperatingHours,
  utcToLocalDayAndMinute,
} from '@/lib/operating-hours'

export interface AppointmentInput {
  staffProfileId: string
  clientId: string
  startTime: string
  durationMinutes: number
  tzOffsetMinutes?: number
  title?: string
  notes?: string
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAny = any

export async function validateAppointmentTime(input: AppointmentInput, operatingHours: unknown): Promise<string | null> {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    return 'Duration must be a positive number of minutes.'
  }

  const startDate = new Date(input.startTime)
  if (Number.isNaN(startDate.getTime())) {
    return 'Invalid appointment start time.'
  }

  const tzOffsetMinutes = Number.isFinite(input.tzOffsetMinutes) ? (input.tzOffsetMinutes as number) : 0
  const { dayKey, minuteOfDay } = utcToLocalDayAndMinute(startDate, tzOffsetMinutes)
  const hours = normalizeOperatingHours(operatingHours)[dayKey]
  const endMinute = minuteOfDay + input.durationMinutes

  if (minuteOfDay < hours.openMinute || endMinute > hours.closeMinute) {
    return `Appointment must be within operating hours (${formatMinuteOfDay(hours.openMinute)}-${formatMinuteOfDay(hours.closeMinute)}).`
  }

  return null
}

export async function createAppointment(input: AppointmentInput) {
  const orgSettings = await getOrgSettings()
  const hoursError = await validateAppointmentTime(input, orgSettings?.operating_hours)
  if (hoursError) return { error: hoursError }

  const supabase = await createClient()

  const { data, error } = await (supabase as SupabaseAny)
    .from('appointments')
    .insert({
      staff_profile_id: input.staffProfileId,
      client_id: input.clientId,
      start_time: input.startTime,
      duration_minutes: input.durationMinutes,
      title: input.title ?? null,
      notes: input.notes ?? null,
    })
    .select('id')
    .single()

  if (error) return { error: (error as { message: string }).message }

  revalidatePath('/dashboard')
  return { id: (data as { id: string }).id }
}

export async function getAppointmentsByDate(dateStr: string, tzOffsetMinutes: number = 0) {
  const supabase = await createClient()

  const dayStartUTC = new Date(`${dateStr}T00:00:00Z`)
  dayStartUTC.setUTCMinutes(dayStartUTC.getUTCMinutes() + tzOffsetMinutes)
  const dayEndUTC = new Date(`${dateStr}T23:59:59Z`)
  dayEndUTC.setUTCMinutes(dayEndUTC.getUTCMinutes() + tzOffsetMinutes)

  const { data, error } = await (supabase as SupabaseAny)
    .from('appointments')
    .select(`
      id,
      staff_profile_id,
      client_id,
      start_time,
      duration_minutes,
      title,
      notes,
      karute_record_id,
      created_at,
      customers:client_id ( name )
    `)
    .gte('start_time', dayStartUTC.toISOString())
    .lte('start_time', dayEndUTC.toISOString())
    .order('start_time', { ascending: true })

  if (error || !data) return []

  return data as AppointmentRow[]
}

export async function linkKaruteToAppointment(appointmentId: string, karuteRecordId: string) {
  const supabase = await createClient()

  const { error } = await (supabase as SupabaseAny)
    .from('appointments')
    .update({ karute_record_id: karuteRecordId })
    .eq('id', appointmentId)

  if (error) return { error: (error as { message: string }).message }

  revalidatePath('/dashboard')
  return { success: true }
}

export async function deleteAppointment(appointmentId: string) {
  const supabase = await createClient()

  const { error } = await (supabase as SupabaseAny)
    .from('appointments')
    .delete()
    .eq('id', appointmentId)

  if (error) return { error: (error as { message: string }).message }

  revalidatePath('/dashboard')
  return { success: true }
}
