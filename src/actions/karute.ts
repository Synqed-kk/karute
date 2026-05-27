'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { getStaffList } from '@/lib/staff'
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

    // staffId comes from the UI (live booking or picker). Validate it belongs
    // to this org's roster — never trust a raw client id against the FK.
    const staffError = await validateStaffId(input.staffId)
    if (staffError) return staffError

    const record = await synqed.karuteRecords.create({
      customer_id: input.customerId,
      staff_id: input.staffId,
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

    // staffId comes from the UI (live booking or picker). Validate it belongs
    // to this org's roster — never trust a raw client id against the FK.
    const staffError = await validateStaffId(input.staffId)
    if (staffError) return staffError

    const record = await synqed.karuteRecords.create({
      customer_id: input.customerId,
      staff_id: input.staffId,
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

/**
 * Create a karute record from the manual-entry dialog (+ 新規カルテ on
 * the karute list). Separate from saveKaruteRecord, which is the
 * recording-flow path that lands with a transcript + AI-extracted
 * entries already in hand.
 *
 * Manual creation is a "draft" record — no transcript, no entries.
 * Staff fills in the entries themselves on the karute detail page,
 * OR they later attach a recording (and the AI pass populates the
 * entries from the transcript).
 *
 * ANTHONY contracts:
 *   • `service` (text) and `duration_minutes` (int) are captured by
 *     the dialog UI but NOT yet persisted — the karute_records
 *     schema doesn't have those columns. Add them + a follow-up
 *     migration backfills existing rows with null. The list-row
 *     renderer (KaruteListRow) already expects both fields; this
 *     will close that gap.
 *   • `session_date` (date) — same situation. The dialog lets staff
 *     pick a date for backdating; today the create call uses
 *     `created_at` (now) implicitly. Adding the column lets staff
 *     log a session from yesterday.
 *
 * Until those columns land, the captured values are dropped server-
 * side. The dialog stays functional — staff get a draft karute
 * record they can open and start adding entries to.
 */
export async function createManualKaruteRecord(input: {
  customerId: string
  staffId: string
  sessionDate: string // YYYY-MM-DD — captured but not persisted yet
  durationMinutes: number // captured but not persisted yet
  service: string // captured but not persisted yet
}): Promise<{ error: string } | void> {
  let recordId: string

  try {
    const synqed = await getSynqedClient()

    const record = await synqed.karuteRecords.create({
      customer_id: input.customerId,
      staff_id: input.staffId,
      status: 'DRAFT',
      // No transcript / no entries on manual create — staff fills
      // those in on the detail page (or via a later recording).
      transcript: null,
      ai_summary: null,
      entries: [],
    })
    recordId = record.id
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unexpected error' }
  }

  // revalidate + redirect outside try/catch — redirect() throws a
  // control-flow exception that try/catch would swallow.
  revalidatePath(`/customers/${input.customerId}`)
  revalidatePath('/karute')
  updateTag('dashboard')
  redirect(`/karute/${recordId}`)
}
