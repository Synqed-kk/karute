'use server'

import { randomUUID } from 'crypto'
import { SynqedClient } from '@synqed-kk/client'
import { createServiceClient } from '@/lib/supabase/service'

type BootstrapResult =
  | { ok: true; businessId: string }
  | { ok: false; error: string }

/**
 * Run once after a fresh signup to make the new user usable:
 *   1. ensure profile row exists with the user's businessId + chosen salon name
 *   2. ensure synqed-core has an OWNER staff member tied to the user for that business
 *
 * Idempotent: safe to call multiple times. The Supabase project has a trigger
 * that auto-creates a `profiles` row on auth.users insert (with full_name = email
 * and a fresh customer_id), so this action UPDATES that row's full_name to the
 * salon name and ENSURES a staff record exists in synqed-core (creating only if
 * one isn't already there for this user).
 *
 * Verifies userId against Supabase Auth via service-role getUserById, so the
 * client can pass user.id from supabase.auth.signUp's response without waiting
 * for session cookies to sync server-side (which would race the action).
 */
export async function bootstrapBusinessForNewUser(
  salonName: string,
  userId: string,
): Promise<BootstrapResult> {
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) {
    return { ok: false, error: 'Server is not configured (missing SYNQED env)' }
  }

  const service = createServiceClient()

  const { data: userResult, error: userError } = await service.auth.admin.getUserById(userId)
  if (userError || !userResult?.user) {
    return { ok: false, error: 'User not found in auth' }
  }
  const user = userResult.user

  // Look up profile (auto-created by Supabase trigger on auth.users insert).
  // Fall back to creating one if the trigger isn't installed.
  const { data: existingProfile } = await service
    .from('profiles')
    .select('customer_id, full_name')
    .eq('id', user.id)
    .maybeSingle()

  let businessId: string
  if (existingProfile?.customer_id) {
    businessId = existingProfile.customer_id as string
    // Update full_name to the salon name if it's still the default (email).
    if (existingProfile.full_name !== salonName) {
      await service
        .from('profiles')
        .update({ full_name: salonName })
        .eq('id', user.id)
    }
  } else {
    businessId = randomUUID()
    const { error: profileErr } = await service.from('profiles').insert({
      id: user.id,
      customer_id: businessId,
      full_name: salonName,
      email: user.email ?? null,
    })
    if (profileErr) {
      return { ok: false, error: `Failed to create profile: ${profileErr.message}` }
    }
  }

  // Ensure synqed-core has a staff record for this user. List existing staff
  // for the business; only create if there's no row already pinned to this userId.
  try {
    const synqed = new SynqedClient({ baseUrl, apiKey, businessId })
    const existingStaff = await synqed.staff.list({ page_size: 200 })
    const alreadyRegistered = existingStaff.staff.some((s) => {
      const userIdField = (s as { user_id?: string | null }).user_id
      return userIdField === user.id
    })
    if (!alreadyRegistered) {
      await synqed.staff.create({
        name: salonName,
        email: user.email ?? null,
        user_id: user.id,
        role: 'OWNER',
      })
    }
  } catch (err) {
    return {
      ok: false,
      error: `Failed to register first staff: ${err instanceof Error ? err.message : 'Unknown error'}`,
    }
  }

  return { ok: true, businessId }
}
