'use server'

import { z } from 'zod'
import { revalidatePath, updateTag } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { getSynqedClient } from '@/lib/synqed/client'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

// ---------------------------------------------------------------------------
// Backend error → user-facing message
// ---------------------------------------------------------------------------

/**
 * Translate raw backend errors (Prisma / synqed-core throws) into
 * locale-aware messages the form's toast can safely display.
 *
 * The synqed-core service layer propagates Prisma errors verbatim
 * (e.g. ``Unique constraint failed on the fields: (`business_id`,
 * `email`)``). Showing that to a user is both ugly and a minor info
 * leak (column names, stack frames). This helper pattern-matches the
 * common shapes and falls back to a generic "save failed" message
 * so users never see Prisma internals.
 *
 * Raw error is still surfaced to server logs in the caller so
 * Anthony can debug from the synqed-core side.
 */
async function translateBackendError(err: unknown): Promise<string> {
  const message = err instanceof Error ? err.message : String(err)
  const t = await getTranslations('customers.form')
  if (/Unique constraint failed.*\bemail\b/i.test(message)) {
    return t('duplicateEmail')
  }
  if (/Unique constraint failed.*\bphone\b/i.test(message)) {
    return t('duplicatePhone')
  }
  return t('saveFailedGeneric')
}

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const CustomerFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  furigana: z.string().max(100).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  // 指名スタッフ — the customer's standing assigned/preferred stylist
  // (a synqed profile id). '' = 指名なし → stored as null. Kept lenient
  // (no .uuid()) so a profile-less staff's fallback id still validates; the
  // DB FK is the real guard. Optional so the quick-create path + older
  // callers that omit it still parse.
  assigned_staff_id: z.string().max(100).optional().or(z.literal('')),
  // 生年月日 ('YYYY-MM-DD') + 性別 ('male' | 'female' | ''). Editable by staff and
  // seeded by the deep crawl — synqed-core accepts both on create/update (the
  // crawl writes them the same way). Age is DERIVED from DOB at render, never
  // stored. '' → null.
  date_of_birth: z.string().max(10).optional().or(z.literal('')),
  gender: z.string().max(10).optional().or(z.literal('')),
  // 職業 + 会員番号 — CRM fields seeded by the deep crawl, also staff-editable. '' → null.
  occupation: z.string().max(100).optional().or(z.literal('')),
  member_number: z.string().max(100).optional().or(z.literal('')),
})

type CustomerFormInput = z.infer<typeof CustomerFormSchema>

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export type ActionResult =
  | { success: true; id: string; duplicateWarning?: string }
  | { success: false; error: string }

// ---------------------------------------------------------------------------
// createCustomer
// ---------------------------------------------------------------------------

export async function createCustomer(input: CustomerFormInput): Promise<ActionResult> {
  const parsed = CustomerFormSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((e) => e.message).join(', '),
    }
  }

  const { name, furigana, phone, email, assigned_staff_id, date_of_birth, gender, occupation, member_number } = parsed.data

  try {
    const synqed = await getSynqedClient()

    // Check for duplicate name — warn but allow creation
    let duplicateWarning: string | undefined
    const dup = await synqed.customers.checkDuplicate(name)
    if (dup.exists && dup.existing_name) {
      duplicateWarning = `A customer named "${dup.existing_name}" already exists`
    }

    const customer = await synqed.customers.create({
      name,
      furigana: furigana || null,
      phone: phone || null,
      email: email || null,
      assigned_staff_id: assigned_staff_id || null,
      date_of_birth: date_of_birth || null,
      gender: gender || null,
      occupation: occupation || null,
      member_number: member_number || null,
    })

    revalidatePath('/customers')
    updateTag('customers')

    return { success: true, id: customer.id, ...(duplicateWarning ? { duplicateWarning } : {}) }
  } catch (err) {
    // Keep the raw error in the server log so Anthony can debug; show
    // the user a clean translated message via translateBackendError.
    console.error('[createCustomer] backend error:', err)
    return { success: false, error: await translateBackendError(err) }
  }
}

// ---------------------------------------------------------------------------
// createQuickCustomer
// ---------------------------------------------------------------------------

export async function createQuickCustomer(
  name: string,
): Promise<{ success: true; id: string; name: string } | { success: false; error: string }> {
  const trimmedName = name.trim()
  if (!trimmedName) {
    return { success: false, error: 'Name is required' }
  }
  if (trimmedName.length > 100) {
    return { success: false, error: 'Name must be 100 characters or fewer' }
  }

  try {
    const synqed = await getSynqedClient()
    const customer = await synqed.customers.create({ name: trimmedName })

    revalidatePath('/customers')
    updateTag('customers')

    return { success: true, id: customer.id, name: customer.name }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// listAssignableStaff — staff options for the 指名スタッフ picker in
// CustomerForm. Returns the tenant roster as {id, name}. Dynamic import keeps
// the staff/auth module off the rest of this server-action bundle (mirrors the
// pattern used by grantCustomerConsent below).
// ---------------------------------------------------------------------------

export async function listAssignableStaff(): Promise<{ id: string; name: string }[]> {
  try {
    const { getStaffList } = await import('@/lib/staff')
    const staff = await getStaffList()
    return staff.map((s) => ({ id: s.id, name: s.full_name ?? 'Unknown' }))
  } catch (err) {
    console.error('[listAssignableStaff] failed:', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// updateCustomer
// ---------------------------------------------------------------------------

export async function updateCustomer(id: string, input: CustomerFormInput | Record<string, unknown>): Promise<ActionResult> {
  try {
    const synqed = await getSynqedClient()

    if ('name' in input && typeof input.name === 'string') {
      const parsed = CustomerFormSchema.safeParse(input)
      if (!parsed.success) {
        return {
          success: false,
          error: parsed.error.issues.map((e) => e.message).join(', '),
        }
      }
      const { name, furigana, phone, email } = parsed.data
      await synqed.customers.update(id, {
        name,
        furigana: furigana || null,
        phone: phone || null,
        email: email || null,
        ...(('notes' in input && input.notes !== undefined) ? { notes: input.notes as string } : {}),
        // 指名スタッフ: only touch it when the form actually sent the field, so
        // partial updates (e.g. booking-memo saves) can't accidentally clear a
        // customer's assigned stylist. '' → null (指名なし).
        ...(('assigned_staff_id' in input)
          ? { assigned_staff_id: (input.assigned_staff_id as string) || null }
          : {}),
        // 生年月日 / 性別 — presence-guarded so partial updates don't wipe them.
        // The edit form seeds current values, so a normal save preserves them.
        ...(('date_of_birth' in input)
          ? { date_of_birth: (input.date_of_birth as string) || null }
          : {}),
        ...(('gender' in input) ? { gender: (input.gender as string) || null } : {}),
        ...(('occupation' in input)
          ? { occupation: (input.occupation as string) || null }
          : {}),
        ...(('member_number' in input)
          ? { member_number: (input.member_number as string) || null }
          : {}),
      })
    } else {
      // Partial update
      await synqed.customers.update(id, input as Record<string, unknown>)
    }

    revalidatePath('/customers')
    revalidatePath(`/customers/${id}`)
    updateTag('customers')
    return { success: true, id }
  } catch (err) {
    console.error('[updateCustomer] backend error:', err)
    return { success: false, error: await translateBackendError(err) }
  }
}

// ---------------------------------------------------------------------------
// deleteCustomer
// ---------------------------------------------------------------------------

export async function deleteCustomer(id: string): Promise<ActionResult> {
  try {
    const synqed = await getSynqedClient()

    // Block deletion if customer has linked karute records
    const karuteList = await synqed.karuteRecords.list({ customer_id: id, page_size: 1 })
    if (karuteList.total > 0) {
      return {
        success: false,
        error: `Cannot delete: this customer has ${karuteList.total} karute record${karuteList.total === 1 ? '' : 's'}. Delete them first.`,
      }
    }

    // Delete all appointments for this customer (server lacks cascade).
    // page_size is capped at 200 server-side; a single customer never has
    // anywhere near that many appointments, so one page covers it.
    const apptList = await synqed.appointments.list({ customer_id: id, page_size: 200 })
    for (const appt of apptList.appointments) {
      await synqed.appointments.delete(appt.id)
    }

    await synqed.customers.delete(id)

    revalidatePath('/customers')
    updateTag('customers')
    return { success: true, id }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// Customer photos
// ---------------------------------------------------------------------------

export async function listCustomerPhotos(customerId: string) {
  const synqed = await getSynqedClient()
  return synqed.customers.listPhotos(customerId)
}

export async function uploadCustomerPhoto(
  customerId: string,
  formData: FormData,
) {
  const file = formData.get('file') as File | null
  if (!file) return { error: 'No file provided' }

  const category = formData.get('category')
  const caption = formData.get('caption')

  try {
    const synqed = await getSynqedClient()
    const photo = await synqed.customers.uploadPhoto(customerId, file, {
      category: typeof category === 'string' ? category : undefined,
      caption: typeof caption === 'string' ? caption : undefined,
    })
    revalidatePath(`/customers/${customerId}`)
    return { photo }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function deleteCustomerPhoto(
  customerId: string,
  photoId: string,
) {
  try {
    const synqed = await getSynqedClient()
    await synqed.customers.deletePhoto(customerId, photoId)
    revalidatePath(`/customers/${customerId}`)
    return { success: true as const }
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ---------------------------------------------------------------------------
// Recording consent
// ---------------------------------------------------------------------------

// RECORDING_CONSENT_POLICY_VERSION lives in @/lib/consent (client-safe single
// source of truth) — a 'use server' module can't export a plain const, and the
// recording gate (client) must compare against the same value.

export async function getCustomerConsent(customerId: string) {
  const synqed = await getSynqedClient()
  return synqed.customers.getConsent(customerId)
}

export async function grantCustomerConsent(
  customerId: string,
  input: { method?: 'VERBAL' | 'WRITTEN' } = {},
) {
  const { getCurrentUserStaffId } = await import('@/lib/staff')
  const staffId = await getCurrentUserStaffId()
  if (!staffId) {
    return {
      ok: false as const,
      error: 'No staff identity for the signed-in user.',
    }
  }
  try {
    const synqed = await getSynqedClient()
    const consent = await synqed.customers.grantConsent(customerId, {
      granted_by_staff_id: staffId,
      policy_version: RECORDING_CONSENT_POLICY_VERSION,
      method: input.method ?? 'VERBAL',
    })
    revalidatePath(`/customers/${customerId}`)
    updateTag('customer-consent')
    return { ok: true as const, consent }
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

export async function revokeCustomerConsent(customerId: string) {
  const { getCurrentUserStaffId } = await import('@/lib/staff')
  const staffId = await getCurrentUserStaffId()
  if (!staffId) {
    return { ok: false as const, error: 'No staff identity for the signed-in user.' }
  }
  try {
    const synqed = await getSynqedClient()
    await synqed.customers.revokeConsent(customerId, staffId)
    revalidatePath(`/customers/${customerId}`)
    updateTag('customer-consent')
    return { ok: true as const }
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
