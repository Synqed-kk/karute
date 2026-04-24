'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getActiveStaffId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import type { SaveKaruteInput } from '@/types/karute'

/**
 * Save a karute record with all AI-extracted entries in a single atomic
 * API call.
 *
 * IMPORTANT: redirect() is called OUTSIDE the try/catch block.
 * redirect() throws a Next.js control-flow exception that would be swallowed
 * by try/catch, silently preventing navigation.
 */
export async function saveKaruteRecord(
  input: SaveKaruteInput,
): Promise<{ error: string } | void> {
  let recordId: string

  try {
    const synqed = await getSynqedClient()

    // Determine staff: if linked to an appointment, use the appointment's staff.
    // Otherwise fall back to the active-staff cookie.
    let staffId = await getActiveStaffId()
    if (input.appointmentId) {
      const appt = await synqed.appointments.get(input.appointmentId).catch(() => null)
      if (appt?.staff_id) staffId = appt.staff_id
    }
    if (!staffId) {
      return { error: 'No active staff member selected. Please select a staff member from the header.' }
    }

    const record = await synqed.karuteRecords.create({
      customer_id: input.customerId,
      staff_id: staffId,
      appointment_id: input.appointmentId ?? null,
      transcript: input.transcript,
      ai_summary: input.summary,
      entries: input.entries.map((entry) => ({
        category: entry.category.toUpperCase() as 'SYMPTOM' | 'TREATMENT' | 'BODY_AREA' | 'PREFERENCE' | 'LIFESTYLE' | 'NEXT_VISIT' | 'PRODUCT' | 'OTHER',
        content: entry.content,
        original_quote: entry.sourceQuote ?? null,
        confidence: entry.confidenceScore,
        is_manual: false,
      })),
    })
    recordId = record.id
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unexpected error' }
  }

  // revalidate and redirect OUTSIDE try/catch — redirect() throws internally
  revalidatePath(`/customers/${input.customerId}`)
  revalidatePath('/dashboard')
  redirect(`/karute/${recordId}`)
}

/**
 * Same as saveKaruteRecord but returns the record ID instead of redirecting.
 * Used by the RecordingPanel which stays on the appointments page.
 */
export async function saveKaruteRecordInline(
  input: SaveKaruteInput,
): Promise<{ id: string } | { error: string }> {
  try {
    const synqed = await getSynqedClient()

    const staffId = await getActiveStaffId()
    if (!staffId) {
      return { error: 'No active staff member selected.' }
    }

    const record = await synqed.karuteRecords.create({
      customer_id: input.customerId,
      staff_id: staffId,
      appointment_id: input.appointmentId ?? null,
      transcript: input.transcript,
      ai_summary: input.summary,
      entries: input.entries.map((entry) => ({
        category: entry.category.toUpperCase() as 'SYMPTOM' | 'TREATMENT' | 'BODY_AREA' | 'PREFERENCE' | 'LIFESTYLE' | 'NEXT_VISIT' | 'PRODUCT' | 'OTHER',
        content: entry.content,
        original_quote: entry.sourceQuote ?? null,
        confidence: entry.confidenceScore,
        is_manual: false,
      })),
    })

    revalidatePath(`/customers/${input.customerId}`)
    return { id: record.id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unexpected error' }
  }
}

export async function deleteKaruteRecord(karuteId: string): Promise<{ success: true } | { error: string }> {
  try {
    const synqed = await getSynqedClient()
    await synqed.karuteRecords.delete(karuteId)
    revalidatePath('/dashboard')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
