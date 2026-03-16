'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export interface AppointmentInput {
  staffProfileId: string
  clientId: string
  startTime: string
  durationMinutes: number
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

export async function createAppointment(input: AppointmentInput) {
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

  const startLocal = new Date(`${dateStr}T00:00:00`)
  startLocal.setMinutes(startLocal.getMinutes() + tzOffsetMinutes)
  const endLocal = new Date(`${dateStr}T23:59:59`)
  endLocal.setMinutes(endLocal.getMinutes() + tzOffsetMinutes)

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
    .gte('start_time', startLocal.toISOString())
    .lte('start_time', endLocal.toISOString())
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
