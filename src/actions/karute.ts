'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import type { SaveKaruteInput } from '@/types/karute'

/**
 * Validate the attribution target is a member of the signed-in org's roster.
 * Returns an error result to short-circuit the save, or null when valid.
 *
 * getStaffList() degrades to [] when synqed-core is unreachable, so an empty
 * roster is treated as a transient fetch failure — not a (misleading)
 * "not part of your salon" rejection.
 */
async function validateStaffId(staffId: string): Promise<{ error: string } | null> {
  const roster = await getStaffList()
  if (roster.length === 0) {
    return { error: 'Could not load your staff roster. Please try again.' }
  }
  if (!roster.some((s) => s.id === staffId)) {
    return { error: 'Selected staff is not part of your salon.' }
  }
  return null
}

/**
 * Resolves the staff id for a save call.
 *
 * Two paths, kept compatible during the staff-id-from-client → staff-id-
 * from-auth migration:
 *  - If the caller supplies input.staffId (legacy callers, the picker-based
 *    review flow), validate it against the org roster and use it.
 *  - Otherwise, derive it from the signed-in user via getCurrentUserStaffId().
 *
 * Either path can return `{ error }`. The caller short-circuits the save.
 */
async function resolveStaffIdForSave(
  inputStaffId: string | undefined,
): Promise<{ staffId: string } | { error: string }> {
  if (inputStaffId) {
    const staffError = await validateStaffId(inputStaffId)
    if (staffError) return staffError
    return { staffId: inputStaffId }
  }
  const current = await getCurrentUserStaffId()
  if (!current) {
    return { error: 'No staff identity for the signed-in user.' }
  }
  return { staffId: current }
}

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

    const resolved = await resolveStaffIdForSave(input.staffId)
    if ('error' in resolved) return resolved

    const record = await synqed.karuteRecords.create({
      customer_id: input.customerId,
      staff_id: resolved.staffId,
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
  updateTag('dashboard')
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

    const resolved = await resolveStaffIdForSave(input.staffId)
    if ('error' in resolved) return resolved

    const record = await synqed.karuteRecords.create({
      customer_id: input.customerId,
      staff_id: resolved.staffId,
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
    updateTag('dashboard')
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
    updateTag('dashboard')
    return { success: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
