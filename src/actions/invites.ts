'use server'

import { randomBytes } from 'crypto'
import { redirect } from 'next/navigation'
import { updateTag } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { getSynqedClient } from '@/lib/synqed/client'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { requireCapability } from '@/lib/auth/require-permission'
import { synqedRoleToPreset } from '@/lib/auth/permissions'
import {
  inviteSchema,
  type InviteInput,
  type InviteRole,
  INVITE_TTL_DAYS,
} from '@/lib/validations/invite'

// ───────────────────────────────────────────────────────────────────────────
// Staff invites — owner creates a tokenized invite; invitee joins via /join.
//
// SECURITY MODEL
//   - The `invites` table lives in synqed-core. Owner-scoped reads/writes go
//     through the business-scoped SDK client (getSynqedClient → x-business-id),
//     so one salon can't touch another's invites. The pre-auth /join lookups use
//     the API-key-gated, business-optional `invites.getByToken` — the 32-byte
//     token is the per-invite secret.
//   - acceptInvite is the trust boundary: it derives the target business AND the
//     account email from the SERVER-VALIDATED invite row — never from client
//     input. The signup trigger was hardened (migration 20260603000000) to ignore
//     client-supplied customer_id, so business attachment can only happen here.
// ───────────────────────────────────────────────────────────────────────────

export interface InviteRow {
  id: string
  email: string
  role: InviteRole
  status: 'pending' | 'accepted' | 'revoked'
  created_at: string
  expires_at: string
}

/** Gate invite management on the `staff.invite` capability (owner + manager by
 *  default) and return the caller's business to scope the writes. */
async function requireInviteBusiness(): Promise<string> {
  await requireCapability('staff.invite')
  return getBusinessId()
}

/** A SynqedClient with NO business scope, for the pre-auth /join flows (the token
 *  is the secret; core's by-token route is API-key-gated, business-optional). */
function getPublicSynqedClient(): SynqedClient {
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) {
    throw new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
  }
  return new SynqedClient({ baseUrl, apiKey, businessId: '' })
}

/** Owner action: create a pending invite, return its token (the dialog builds the
 *  full link with origin + locale). */
export async function createInvite(
  input: InviteInput,
): Promise<{ token: string } | { error: string }> {
  const parsed = inviteSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') }
  }

  let businessId: string
  try {
    businessId = await requireInviteBusiness()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }

  const { email, role } = parsed.data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  // Don't invite someone already in this business. Case-insensitive: the invite
  // email is normalized lowercase, but profile emails may carry the original
  // signup casing, so `.eq` would miss them. (Greptile flag, #158.)
  const { data: existingMember } = await service
    .from('profiles')
    .select('id')
    .ilike('email', email)
    .eq('customer_id', businessId)
    .maybeSingle()
  if (existingMember) return { error: 'That email is already a member of this salon.' }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString()
  const invitedBy = await getCurrentUserStaffId().catch(() => null)

  try {
    const synqed = await getSynqedClient()
    await synqed.invites.create({
      email,
      role,
      token,
      invited_by: invitedBy,
      expires_at: expiresAt,
    })
  } catch (e) {
    return { error: `Could not create invite: ${e instanceof Error ? e.message : 'unknown error'}` }
  }

  updateTag('staff-invites')
  return { token }
}

/** Owner action: list this business's pending invites. */
export async function listInvites(): Promise<InviteRow[]> {
  try {
    await requireCapability('staff.invite')
  } catch {
    return []
  }
  try {
    const synqed = await getSynqedClient()
    const { invites } = await synqed.invites.list()
    // Core returns all statuses (createdAt desc); the UI only wants pending.
    return invites
      .filter((i) => i.status === 'pending')
      .map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role as InviteRole,
        status: i.status as InviteRow['status'],
        created_at: i.created_at,
        expires_at: i.expires_at ?? '',
      }))
  } catch {
    return []
  }
}

/** Owner action: revoke a pending invite (scoped to this business). */
export async function revokeInvite(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireCapability('staff.invite')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  try {
    // updateStatus is business-scoped server-side (id + x-business-id), so a
    // foreign invite id can't be revoked across tenants.
    const synqed = await getSynqedClient()
    await synqed.invites.updateStatus(id, 'revoked')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not revoke invite.' }
  }
  updateTag('staff-invites')
  return { ok: true }
}

/** Public (unauthenticated) — validate a token for the /join page. Returns only
 *  what the page needs to render; never leaks the token or business internals. */
export async function getInviteByToken(
  token: string,
): Promise<
  | { valid: true; email: string; salonName: string }
  | { valid: false; reason: 'missing' | 'not_found' | 'used' | 'revoked' | 'expired' }
> {
  if (!token) return { valid: false, reason: 'missing' }

  // Token lookup against core (API-key-gated, no business scope needed pre-auth).
  let invite
  try {
    invite = await getPublicSynqedClient().invites.getByToken(token)
  } catch {
    return { valid: false, reason: 'not_found' }
  }
  if (!invite) return { valid: false, reason: 'not_found' }
  if (invite.status === 'accepted') return { valid: false, reason: 'used' }
  if (invite.status === 'revoked') return { valid: false, reason: 'revoked' }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return { valid: false, reason: 'expired' }
  }

  // Salon name = the owner's profile full_name (set to the salon name at signup);
  // the owner is the first profile created in the business. (profiles still live
  // in Supabase until the auth cutover.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any
  const { data: owner } = await service
    .from('profiles')
    .select('full_name')
    .eq('customer_id', invite.business_id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return { valid: true, email: invite.email as string, salonName: owner?.full_name ?? 'Karute' }
}

/** Public (unauthenticated) — accept an invite: create the account, attach it to
 *  the inviting business SERVER-SIDE, link the synqed staff record, sign in.
 *  email + business come from the validated invite, not from the caller. */
export async function acceptInvite(
  token: string,
  password: string,
  fullName: string,
  locale: string,
): Promise<{ error: string } | void> {
  if (!token || password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }
  const name = fullName.trim()
  if (!name) return { error: 'Your name is required.' }

  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) return { error: 'Server is not configured.' }

  // 1. Validate the token server-side against core.
  let invite
  try {
    invite = await getPublicSynqedClient().invites.getByToken(token)
  } catch {
    invite = null
  }
  if (
    !invite ||
    invite.status !== 'pending' ||
    (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now())
  ) {
    return { error: 'This invite link is invalid or has expired.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any

  const email = invite.email as string // trusted: from the invite, not the client
  const role = invite.role as InviteRole

  // 2. Create the auth user (the invite IS the email verification).
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  })
  if (createErr || !created?.user) {
    const already = (createErr?.message ?? '').toLowerCase().includes('already')
    return {
      error: already
        ? 'This email already has an account — sign in to accept, or ask the owner to resend.'
        : createErr?.message || 'Could not create the account.',
    }
  }
  const userId = created.user.id as string

  // 3. Attach the new profile to the inviting business (the trigger gave it a
  //    throwaway business; overwrite it). customer_id is from the invite.
  const { error: attachErr } = await service
    .from('profiles')
    .update({
      customer_id: invite.business_id,
      full_name: name,
      display_role: role.toLowerCase(),
      permission_role: synqedRoleToPreset(role), // seed the RBAC preset; owner can customize later
    })
    .eq('id', userId)
  if (attachErr) {
    // Roll back the just-created auth user so the invite stays usable — otherwise
    // the invitee's email is taken with no business attached and no self-service
    // retry, and the owner still sees the invite as pending. (Greptile P1, #158.)
    try {
      await service.auth.admin.deleteUser(userId)
    } catch {
      /* best-effort — surface the original attach error regardless */
    }
    return { error: `Could not join the salon: ${attachErr.message}` }
  }

  // 4. Create / link the synqed-core staff record under the business.
  const synqed = new SynqedClient({ baseUrl, apiKey, businessId: invite.business_id })
  try {
    const { staff } = await synqed.staff.list({ page_size: 200 })
    const existing = staff.find(
      (s) => s.email && s.email.toLowerCase() === email.toLowerCase(),
    )
    if (existing) {
      await synqed.staff.update(existing.id, { user_id: userId, role })
    } else {
      await synqed.staff.create({ name, email, user_id: userId, role })
    }
  } catch (err) {
    // Non-fatal: the profile is already attached; staff-map.ts self-heals the
    // synqed link on first use.
    console.error('[acceptInvite] synqed staff link failed:', err)
  }

  // 5. Mark the invite used (in core; business scope = the invite's business).
  try {
    await synqed.invites.updateStatus(invite.id, 'accepted')
  } catch (err) {
    // Non-fatal: the account is already created + attached. Worst case the invite
    // still reads 'pending' but its token now resolves to an existing account.
    console.error('[acceptInvite] mark-accepted failed:', err)
  }
  updateTag('staff-list')
  updateTag('staff-invites')

  // 6. Sign in (cookie session) and land in the owner's store.
  const supabase = await createClient()
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
  if (signInErr) redirect(`/${locale}/login`)
  redirect(`/${locale}/sessions`)
}
