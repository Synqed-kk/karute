'use server'

import { z } from 'zod'
import { revalidatePath, updateTag } from 'next/cache'
import { getSynqedClient } from '@/lib/synqed/client'

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const CustomerFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  furigana: z.string().max(100).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
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

  const { name, furigana, phone, email } = parsed.data

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
    })

    revalidatePath('/customers')
    updateTag('customers')

    return { success: true, id: customer.id, ...(duplicateWarning ? { duplicateWarning } : {}) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
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
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
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

    // Delete all appointments for this customer (server lacks cascade)
    const apptList = await synqed.appointments.list({ customer_id: id, page_size: 500 })
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

// Bump when the wording of the consent script changes — invalidates prior consents legally.
const RECORDING_CONSENT_POLICY_VERSION = 'v1-2026-05'

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
