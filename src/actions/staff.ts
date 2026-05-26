'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { SynqedError } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { createServiceClient } from '@/lib/supabase/service'
import { staffProfileSchema, type StaffProfileInput } from '@/lib/validations/staff'

// Look up an existing Supabase profile by email. Returns its id (which equals
// auth.users.id) when found, else null. Lets createStaff seed synqed
// staff.user_id at insert time when the teammate already has an auth account.
async function findProfileIdByEmail(email: string): Promise<string | null> {
  const service = createServiceClient()
  const { data } = await service
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

export async function createStaff(data: StaffProfileInput): Promise<void> {
  const parsed = staffProfileSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((e) => e.message).join(', '))
  }

  const email = parsed.data.email || null
  const userId = email ? await findProfileIdByEmail(email) : null

  const synqed = await getSynqedClient()
  await synqed.staff.create({
    name: parsed.data.name,
    email,
    user_id: userId,
  })

  revalidatePath('/settings')
  updateTag('staff-list')
}

export async function updateStaff(id: string, data: StaffProfileInput): Promise<void> {
  const parsed = staffProfileSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((e) => e.message).join(', '))
  }

  const synqed = await getSynqedClient()
  await synqed.staff.update(id, {
    name: parsed.data.name,
    email: parsed.data.email || null,
  })

  revalidatePath('/settings')
  updateTag('staff-list')
}

/**
 * Deletes a staff profile. Server enforces guards (last member, attributed
 * records) and returns 400 with a human message when either triggers.
 */
export async function deleteStaff(id: string): Promise<void> {
  const synqed = await getSynqedClient()

  try {
    await synqed.staff.delete(id)
  } catch (err) {
    if (err instanceof SynqedError && err.status === 400) {
      throw new Error(err.message)
    }
    throw err
  }

  revalidatePath('/settings')
  revalidatePath('/', 'layout')
  updateTag('staff-list')
}

export async function uploadStaffAvatar(
  staffId: string,
  formData: FormData,
): Promise<{ url: string } | { error: string }> {
  const file = formData.get('file') as File | null
  if (!file) return { error: 'No file provided' }

  try {
    const synqed = await getSynqedClient()
    const { avatar_url } = await synqed.staff.uploadAvatar(staffId, file)
    revalidatePath('/settings')
    revalidatePath('/', 'layout')
    updateTag('staff-list')
    return { url: avatar_url }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
