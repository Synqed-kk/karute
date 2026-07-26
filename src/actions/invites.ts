'use server'

import { randomBytes } from 'crypto'
import { redirect } from 'next/navigation'
import { updateTag } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { getSynqedClient, newSynqedClient } from '@/lib/synqed/client'
import { orgSettingsWithClient } from '@/actions/org-settings'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { chooseStaffToLink } from '@/lib/invites/link'
import { requireCapability } from '@/lib/auth/require-permission'
import { audit } from '@/lib/audit'
import { auditWeb, resolveWebActorId, resolveWebAuditContext } from '@/lib/audit-web'
import { synqedRoleToPreset } from '@/lib/auth/permissions'
import {
  inviteSchema,
  type InviteInput,
  type InviteRole,
  INVITE_TTL_DAYS,
} from '@/lib/validations/invite'

// Explicit-client seam (design-parity packet 12 §S4b — the P-B pattern, same
// as the S4a cores): the cores below take this instead of resolving
// getSynqedClient() from the cookie session, so the facade (Bearer path) and
// the web actions run the IDENTICAL write logic.
type InviteClient = Pick<SynqedClient, 'invites'>

/** Identity + provenance a Bearer/cookie caller feeds an invite write core. */
type InviteWriteDeps = {
  actorId: string | null
  source: 'web' | 'facade'
}

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
  /** A login with this email is ALREADY a member of the business — the
   *  invite is a ghost (its person got in some other way, or mark-accepted
   *  failed). The UI shows 接続済み instead of an eternal 保留中. */
  linked?: boolean
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

/** Client-threaded core of createInvite (facade Bearer path, design-parity
 *  packet 12 §S4b). `invitedBy` is explicit — web resolves it via the
 *  cookie-bound getCurrentUserStaffId, the facade via the Bearer identity
 *  roster row (selfRow idiom); never caller-supplied. businessId is
 *  REQUIRED — it scopes the existing-member lookup (tenant boundary), not
 *  just the audit row. */
export async function createInviteCore(
  synqed: InviteClient,
  businessId: string,
  deps: InviteWriteDeps,
  invitedBy: string | null,
  input: InviteInput,
): Promise<{ token: string } | { error: string }> {
  const { email, role, staffId } = input
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

  let created: { id?: string }
  try {
    created = await synqed.invites.create({
      email,
      role,
      token,
      invited_by: invitedBy,
      invited_staff_id: staffId ?? null,
      expires_at: expiresAt,
    })
  } catch (e) {
    return { error: `Could not create invite: ${e instanceof Error ? e.message : 'unknown error'}` }
  }

  // ids only — the invite email is deliberately NOT logged (PII-free sink rule).
  audit({
    category: 'staff',
    action: 'staff.invite_create',
    actorId: deps.actorId,
    actorType: 'staff',
    businessId,
    targetType: staffId ? 'staff' : undefined,
    targetId: staffId ?? undefined,
    detail: { invite_id: created.id ?? null, role, reinvite: !!staffId },
    source: deps.source,
  })

  return { token }
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

  // Plan gate (P4): staff cap, shared with createStaff via staffAddAllowed —
  // inert until billing arms. Machine code; the dialog maps it to copy.
  // Skipped for re-invites (staffId present): those ATTACH to an existing
  // staff row, adding nobody. acceptInvite stays ungated by design — the gate
  // lives at door-open time, and pending brand-new invites are counted.
  if (!parsed.data.staffId) {
    const { staffAddAllowed } = await import('@/lib/subscription/feature-gate')
    const gate = await staffAddAllowed()
    if (!gate.allowed) return { error: 'STAFF_LIMIT_REACHED' }
  }

  let synqed: InviteClient
  try {
    synqed = await getSynqedClient()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unknown error' }
  }
  const invitedBy = await getCurrentUserStaffId().catch(() => null)
  const actorId = await resolveWebActorId()
  const result = await createInviteCore(synqed, businessId, { actorId, source: 'web' }, invitedBy, parsed.data)
  if ('token' in result) updateTag('staff-invites')
  return result
}

/** Client-threaded core of listInvites (facade Bearer path, design-parity
 *  packet 12 §S4b). Never throws — degrades to [] the same way the web
 *  action's own catch does. */
export async function listInvitesWithClient(
  synqed: InviteClient,
  memberEmails?: Set<string>,
): Promise<InviteRow[]> {
  try {
    const { invites } = await synqed.invites.list()
    const pending = invites.filter((i) => i.status === 'pending')
    // Second linkage signal (Greptile #626 P1): a profile can lack an email
    // value, so the email match alone can miss a connected person. If the
    // card an invite was launched from already carries a user_id, that
    // person is wired regardless of which email their login ended up on.
    // Best-effort — a roster read failure just means fewer 接続済み badges.
    let wiredCardIds = new Set<string>()
    const staffApi = (synqed as Partial<SynqedClient>).staff
    if (staffApi && pending.some((i) => i.invited_staff_id)) {
      try {
        const { staff } = await staffApi.list({ page_size: 200 })
        wiredCardIds = new Set(
          staff
            .filter((s) => (s as { user_id?: string | null }).user_id)
            .map((s) => s.id),
        )
      } catch {
        /* roster unavailable — email signal still applies */
      }
    }
    // Core returns all statuses (createdAt desc); the UI only wants pending.
    return pending.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role as InviteRole,
      status: i.status as InviteRow['status'],
      created_at: i.created_at,
      expires_at: i.expires_at ?? '',
      linked:
        (memberEmails?.has(i.email.toLowerCase()) ?? false) ||
        (!!i.invited_staff_id && wiredCardIds.has(i.invited_staff_id)),
    }))
  } catch {
    return []
  }
}

/** Login emails already attached to this business — a pending invite matching
 *  one is a ghost (best-effort: an empty set just means no 接続済み badges).
 *  Exported for the facade GET (same truth on the shell). */
export async function memberEmailsForBusiness(businessId: string): Promise<Set<string>> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = createServiceClient() as any
    const { data } = await service.from('profiles').select('email').eq('customer_id', businessId)
    return new Set(
      ((data ?? []) as { email: string | null }[])
        .map((r) => r.email?.toLowerCase())
        .filter((e): e is string => !!e),
    )
  } catch {
    return new Set()
  }
}

/** Owner action: list this business's pending invites. */
export async function listInvites(): Promise<InviteRow[]> {
  try {
    await requireCapability('staff.invite')
  } catch {
    return []
  }
  try {
    const businessId = await getBusinessId()
    const synqed = await getSynqedClient()
    return await listInvitesWithClient(synqed, await memberEmailsForBusiness(businessId))
  } catch {
    return []
  }
}

/** Client-threaded core of revokeInvite (facade Bearer path, design-parity
 *  packet 12 §S4b). businessId is AUDIT-ONLY — updateStatus is already
 *  business-scoped server-side by the synqed client (id + x-business-id). */
export async function revokeInviteCore(
  synqed: InviteClient,
  businessId: string | null,
  deps: InviteWriteDeps,
  id: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    // updateStatus is business-scoped server-side (id + x-business-id), so a
    // foreign invite id can't be revoked across tenants.
    await synqed.invites.updateStatus(id, 'revoked')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not revoke invite.' }
  }
  audit({
    category: 'staff',
    action: 'staff.invite_revoke',
    actorId: deps.actorId,
    actorType: 'staff',
    businessId,
    detail: { invite_id: id },
    source: deps.source,
  })
  return { ok: true }
}

/** Owner action: revoke a pending invite (scoped to this business). */
export async function revokeInvite(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireCapability('staff.invite')
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }

  let synqed: InviteClient
  try {
    synqed = await getSynqedClient()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unknown error' }
  }
  const { actorId, businessId } = await resolveWebAuditContext()
  const result = await revokeInviteCore(synqed, businessId, { actorId, source: 'web' }, id)
  if ('ok' in result) updateTag('staff-invites')
  return result
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

  // Salon name = org truth (settings 事業所名 via core orgSettings), scoped to
  // the invite's business. NOT the owner's profile full_name — that is a
  // person's name, and editing it (e.g. the 7/26 owner-name fix) silently
  // renamed the join screen. Fallback 'Karute' (unconfigured salon or core
  // read failure) — the pre-auth join page must still render.
  let salonName = 'Karute'
  try {
    const settings = await orgSettingsWithClient(newSynqedClient(invite.business_id))
    if (settings?.salon_name) salonName = settings.salon_name
  } catch {
    /* degrade to fallback — name is chrome here, never blocks joining */
  }

  return { valid: true, email: invite.email as string, salonName }
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
      // Honest copy: NO code path accepts an invite by signing in (only this
      // create-password flow calls acceptInvite) — the old "sign in to
      // accept" promised a flow that doesn't exist and stranded people on
      // unconnected accounts.
      error: already
        ? 'This email already has an account, and signing in cannot accept an invite. Ask the owner to connect your existing account instead.'
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

  // The join is real from here (steps 4–5 are best-effort): the invitee became
  // a member of the business, actor = the new account itself (no session yet,
  // so the ids are passed explicitly).
  await auditWeb({
    category: 'staff',
    action: 'staff.add',
    actorId: userId,
    businessId: invite.business_id as string,
    targetType: 'staff',
    targetId: userId,
    detail: { via: 'invite', invite_id: invite.id as string, role },
  })

  // 4. Link the synqed-core staff record under the business. Prefer the staff row
  //    the invite was launched from (invited_staff_id) so re-inviting an existing
  //    person — at a new email, or with no email on file — ATTACHES to their
  //    record (and its history) instead of minting a duplicate. Falls back to an
  //    email match, then creates a new row for a brand-new hire.
  const synqed = new SynqedClient({ baseUrl, apiKey, businessId: invite.business_id })
  try {
    const { staff } = await synqed.staff.list({ page_size: 200 })
    const linkId = chooseStaffToLink(invite.invited_staff_id, email, staff)
    if (linkId) {
      await synqed.staff.update(linkId, { user_id: userId, role })
    } else {
      await synqed.staff.create({ name, email, user_id: userId, role })
    }
  } catch (err) {
    // Non-fatal for the JOIN (the profile is attached; the person is in) —
    // but never silent again: an unwired card breaks permissions, recording
    // attribution, and audit identity until someone re-links it, so the
    // failure lands in 監査ログ where the owner actually looks. (This exact
    // silent failure hid a half-joined staff member for 11 days.)
    console.error('[acceptInvite] synqed staff link failed:', err)
    await auditWeb({
      category: 'staff',
      action: 'staff.link_failed',
      severity: 'warning',
      actorId: userId,
      businessId: invite.business_id as string,
      targetType: 'staff',
      targetId: userId,
      detail: { via: 'invite', invite_id: invite.id as string, role },
    })
  }

  // 5. Mark the invite used (in core; business scope = the invite's business).
  try {
    await synqed.invites.updateStatus(invite.id, 'accepted')
  } catch (err) {
    // Non-fatal: the account is already created + attached. But a pending-
    // forever ghost invite misleads the owner (and re-invites mint NEW rows,
    // never reconciling) — so the miss lands in 監査ログ too.
    console.error('[acceptInvite] mark-accepted failed:', err)
    await auditWeb({
      category: 'staff',
      action: 'staff.invite_mark_failed',
      severity: 'warning',
      actorId: userId,
      businessId: invite.business_id as string,
      targetType: 'staff',
      targetId: userId,
      detail: { via: 'invite', invite_id: invite.id as string },
    })
  }
  updateTag('staff-list')
  updateTag('staff-invites')

  // 6. Sign in (cookie session) and land in the owner's store.
  const supabase = await createClient()
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
  if (signInErr) redirect(`/${locale}/login`)
  redirect(`/${locale}/sessions`)
}
