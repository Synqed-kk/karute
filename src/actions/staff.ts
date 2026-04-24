'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { SynqedError } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { staffProfileSchema, type StaffProfileInput } from '@/lib/validations/staff'
import { getActiveStaffId } from '@/lib/staff'

export async function createStaff(data: StaffProfileInput): Promise<void> {
  const parsed = staffProfileSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((e) => e.message).join(', '))
  }

  const synqed = await getSynqedClient()
  await synqed.staff.create({
    name: parsed.data.name,
    email: parsed.data.email || null,
  })

  revalidatePath('/settings')
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
}

/**
 * Deletes a staff profile. Server enforces guards (last member, attributed
 * records) and returns 400 with a human message when either triggers. If the
 * active-staff cookie pointed at the deleted staff, this function switches
 * to the first remaining staff.
 */
export async function deleteStaff(id: string): Promise<void> {
  const synqed = await getSynqedClient()

  const activeStaffId = await getActiveStaffId()
  const isActiveMember = activeStaffId === id

  try {
    await synqed.staff.delete(id)
  } catch (err) {
    if (err instanceof SynqedError && err.status === 400) {
      throw new Error(err.message)
    }
    throw err
  }

  if (isActiveMember) {
    const remaining = await synqed.staff.list({ page_size: 1 })
    if (remaining.staff.length > 0) {
      await setActiveStaff(remaining.staff[0].id)
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
    return { url: avatar_url }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
