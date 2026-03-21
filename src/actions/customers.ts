'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { checkDuplicateName } from '@/lib/customers/queries'

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

/**
 * Creates a new customer record.
 *
 * Validates input, checks for duplicate names (warns but does not block),
 * inserts the customer, and revalidates /customers.
 *
 * Per user decision: duplicate name returns a warning alongside success — the
 * sheet closes, list refreshes, toast shows. No redirect is called here.
 */
export async function createCustomer(input: CustomerFormInput): Promise<ActionResult> {
  const parsed = CustomerFormSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((e) => e.message).join(', '),
    }
  }

  const { name, furigana, phone, email } = parsed.data

  // Check for duplicate name — warn but allow creation
  let duplicateWarning: string | undefined
  const { exists, existingName } = await checkDuplicateName(name)
  if (exists && existingName) {
    duplicateWarning = `A customer named "${existingName}" already exists`
  }

  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from('customers')
      .insert([
        {
          name,
          furigana: furigana || null,
          phone: phone || null,
          email: email || null,
          contact_info: null,
          notes: null,
        },
      ])
      .select('id')
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    revalidatePath('/customers')

    return { success: true, id: data.id, ...(duplicateWarning ? { duplicateWarning } : {}) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// createQuickCustomer
// ---------------------------------------------------------------------------

/**
 * Minimal customer creation for the inline "Quick Create" flow in SaveKaruteFlow.
 * Only requires a name — all other fields are optional and left null.
 *
 * Returns { id, name } so the caller can immediately select the new customer.
 */
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

  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from('customers')
      .insert([
        {
          name: trimmedName,
          furigana: null,
          phone: null,
          email: null,
          contact_info: null,
          notes: null,
        },
      ])
      .select('id, name')
      .single()

    if (error) {
      return { success: false, error: error.message }
    }

    revalidatePath('/customers')

    return { success: true, id: data.id, name: data.name }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// updateCustomer
// ---------------------------------------------------------------------------

/**
 * Updates an existing customer record by id.
 *
 * Validates input, updates the row, and revalidates both the list page
 * and the customer's profile page.
 */
export async function updateCustomer(id: string, input: CustomerFormInput | Record<string, unknown>): Promise<ActionResult> {
  const supabase = await createClient()

  // If it looks like a full form submission, validate
  if ('name' in input && typeof input.name === 'string') {
    const parsed = CustomerFormSchema.safeParse(input)
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues.map((e) => e.message).join(', '),
      }
    }
    const { name, furigana, phone, email } = parsed.data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {
      name,
      furigana: furigana || null,
      phone: phone || null,
      email: email || null,
    }
    // Merge any extra fields (customer_type, notes, tags, etc.)
    for (const key of ['customer_type', 'notes', 'tags', 'assigned_staff_id'] as const) {
      if (key in input) {
        updateData[key] = (input as Record<string, unknown>)[key]
      }
    }
    try {
      const { error } = await supabase.from('customers').update(updateData).eq('id', id)
      if (error) return { success: false, error: error.message }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  } else {
    // Partial update (e.g. just customer_type or notes)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('customers').update(input).eq('id', id)
      if (error) return { success: false, error: error.message }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  }

  revalidatePath('/customers')
  revalidatePath(`/customers/${id}`)
  return { success: true, id }
}

/**
 * Delete a customer by ID.
 * Checks for linked karute records first.
 */
export async function deleteCustomer(id: string): Promise<ActionResult> {
  const supabase = await createClient()

  // Check for linked karute records
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

  // Delete appointments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('appointments').delete().eq('client_id', id)

  // Delete customer
  const { error } = await supabase.from('customers').delete().eq('id', id)
  if (error) {
    return { success: false, error: error.message }
  }

  revalidatePath('/customers')
  return { success: true, id }
}
