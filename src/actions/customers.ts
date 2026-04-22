'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
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
  // Check for linked karute records — still via Supabase since karute_records
  // aren't in synqed-core yet
  const supabase = await createClient()
  const { count } = await supabase
    .from('karute_records')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', id)

  if ((count ?? 0) > 0) {
    return {
      success: false,
      error: `Cannot delete: this customer has ${count} karute record${count === 1 ? '' : 's'}. Delete them first.`,
    }
  }

  // Delete appointments via Supabase
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('appointments').delete().eq('client_id', id)

  try {
    // Delete customer via synqed-core
    const synqed = await getSynqedClient()
    await synqed.customers.delete(id)

    revalidatePath('/customers')
    return { success: true, id }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}
