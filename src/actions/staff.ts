'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { staffProfileSchema, type StaffProfileInput } from '@/lib/validations/staff'
import { getActiveStaffId } from '@/lib/staff'

/**
 * Creates a new staff profile.
 * Validates input with staffProfileSchema before inserting.
 */
export async function createStaff(data: StaffProfileInput): Promise<void> {
  const parsed = staffProfileSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((e) => e.message).join(', '))
  }

  const supabase = await createClient()

  // Get a customer_id (business tenant) so the new staff profile belongs
  // to the same business. Try auth user's profile first, fall back to any profile.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  let customerIdValue: string | null = null

  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('customer_id')
    .eq('id', user.id)
    .single()

  if (ownerProfile?.customer_id) {
    customerIdValue = ownerProfile.customer_id
  } else {
    // Fallback: use any existing profile's customer_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: anyProfile } = await (supabase as any)
      .from('profiles')
      .select('customer_id')
      .not('customer_id', 'is', null)
      .limit(1)
      .single()
    customerIdValue = anyProfile?.customer_id ?? null
  }

  if (!customerIdValue) throw new Error('Business profile not found')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('profiles')
    .insert([{
      id: crypto.randomUUID(),
      full_name: parsed.data.name,
      customer_id: customerIdValue,
      position: parsed.data.position ?? '',
      email: parsed.data.email ?? '',
      phone: parsed.data.phone ?? '',
    }])

  if (error) throw new Error(error.message)

  revalidatePath('/settings')
}

/**
 * Updates an existing staff profile's name.
 * Validates input with staffProfileSchema before updating.
 */
export async function updateStaff(id: string, data: StaffProfileInput): Promise<void> {
  const parsed = staffProfileSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((e) => e.message).join(', '))
  }

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('profiles')
    .update({
      full_name: parsed.data.name,
      position: parsed.data.position ?? '',
      email: parsed.data.email ?? '',
      phone: parsed.data.phone ?? '',
    })
    .eq('id', id)

  if (error) throw new Error(error.message)

  revalidatePath('/settings')
}

/**
 * Deletes a staff profile with three guards:
 * 1. Blocks deletion of the last remaining staff member.
 * 2. Blocks deletion if the staff has attributed karute records.
 * 3. Auto-switches the active_staff_id cookie if the deleted staff was active.
 */
export async function deleteStaff(id: string): Promise<void> {
  const supabase = await createClient()

  // Guard 1: Block deletion if this is the last remaining staff member
  const { count: totalCount, error: countError } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })

  if (countError) throw new Error(countError.message)
  if ((totalCount ?? 0) <= 1) {
    throw new Error('Cannot delete the last staff member.')
  }

  // Guard 2: Block deletion if staff has attributed karute records
  const { count: recordCount, error: recordError } = await supabase
    .from('karute_records')
    .select('id', { count: 'exact', head: true })
    .eq('staff_profile_id', id)

  if (recordError) throw new Error(recordError.message)
  if ((recordCount ?? 0) > 0) {
    throw new Error(
      `This staff member has ${recordCount} karute record${recordCount === 1 ? '' : 's'} and cannot be deleted.`
    )
  }

  // Guard 3: Auto-switch active staff cookie if this staff member is currently active
  const activeStaffId = await getActiveStaffId()
  const isActiveMember = activeStaffId === id

  // Delete the staff profile
  const { error: deleteError } = await supabase
    .from('profiles')
    .delete()
    .eq('id', id)

  if (deleteError) throw new Error(deleteError.message)

  // After deletion, auto-switch active staff to the first alphabetical remaining member
  if (isActiveMember) {
    const { data: remaining } = await supabase
      .from('profiles')
      .select('id')
      .order('full_name', { ascending: true })
      .limit(1)
      .single()

    if (remaining) {
      await setActiveStaff(remaining.id)
    }
  }

  revalidatePath('/settings')
  revalidatePath('/', 'layout')
}

/**
 * Writes the active_staff_id cookie.
 * Cookie is httpOnly: false so the header switcher UI can read it client-side.
 * 30-day expiry persists selection across browser sessions.
 *
 * Security note: This action only writes a cookie — it does not accept untrusted
 * client data for save operations. All karute save flows read staff_id from the
 * cookie via getActiveStaffId(), never from client form fields.
 */
export async function setActiveStaff(staffId: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set('active_staff_id', staffId, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })

  revalidatePath('/', 'layout')
}

export async function uploadStaffAvatar(staffId: string, formData: FormData): Promise<{ url: string } | { error: string }> {
  const file = formData.get('file') as File | null
  if (!file) return { error: 'No file provided' }

  const supabase = await createClient()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${staffId}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true })

  if (uploadError) return { error: uploadError.message }

  const { data: { publicUrl } } = supabase.storage
    .from('avatars')
    .getPublicUrl(path)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (supabase as any)
    .from('profiles')
    .update({ avatar_url: publicUrl })
    .eq('id', staffId)

  if (updateError) return { error: updateError.message }

  revalidatePath('/settings')
  revalidatePath('/', 'layout')
  return { url: publicUrl }
}
