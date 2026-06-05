'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { SynqedError } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId } from '@/lib/staff'
import { createServiceClient } from '@/lib/supabase/service'
import { requireCapability } from '@/lib/auth/require-permission'
import { staffProfileSchema, type StaffProfileInput } from '@/lib/validations/staff'

// Look up an existing Supabase profile by email. Returns its id (which equals
// auth.users.id) when found, else null. Lets createStaff seed synqed
// staff.user_id at insert time when the teammate already has an auth account
// — otherwise the link is filled in later by the resolver's self-heal path
// in src/lib/synqed/staff-map.ts.
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
  await requireCapability('staff.invite')
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
  await requireCapability('staff.manage') // editing a staff record = managing staff (Greptile #159)
  const parsed = staffProfileSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((e) => e.message).join(', '))
  }

  const service = createServiceClient()
  const businessId = await getBusinessId()

  // The roster surfaces profile-backed staff (the owner + signed-up teammates)
  // from Supabase `profiles`, keyed by profiles.id — NOT the synqed staff id.
  // So an edit on one of those must update the profile row, which is where the
  // list reads the name from. Only owner-created teammates who haven't signed
  // up yet live solely in synqed-core (keyed by synqed staff.id); those still
  // route through the synqed client. Passing a profiles.id to
  // synqed.staff.update was the "SynqedError: Staff not found" 500 on save.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await (service as any)
    .from('profiles')
    .select('id')
    .eq('id', id)
    .eq('customer_id', businessId)
    .maybeSingle()

  if (profile) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (service as any)
      .from('profiles')
      .update({
        full_name: parsed.data.name,
        position: parsed.data.position || null,
      })
      .eq('id', id)
      .eq('customer_id', businessId)
    if (error) {
      throw new Error(`Could not update staff: ${error.message}`)
    }
    // email intentionally NOT updated here — a profile's email is its auth
    // login, so changing it needs the re-confirmation flow the dialog hints at
    // ("Changing the email requires re-confirmation"), which isn't wired yet.
    // Name + position are the safe, in-scope edits.
  } else {
    // synqed-only staff (owner-created, not yet signed up) — `id` is already a
    // synqed staff id, so the synqed client is the correct write target.
    const synqed = await getSynqedClient()
    await synqed.staff.update(id, {
      name: parsed.data.name,
      email: parsed.data.email || null,
    })
  }

  revalidatePath('/settings')
  updateTag('staff-list')
}

/**
 * Deletes a staff profile. Server enforces guards (last member, attributed
 * records) and returns 400 with a human message when either triggers.
 */
export async function deleteStaff(id: string): Promise<void> {
  await requireCapability('staff.manage') // owner + manager only (per the matrix)
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
  try {
    await requireCapability('staff.manage') // changing a staff avatar = managing staff (Greptile #159)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
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
