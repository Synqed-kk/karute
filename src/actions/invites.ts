'use server'

import { redirect } from 'next/navigation'
import { updateTag } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { getSynqedClient, newSynqedClient } from '@/lib/synqed/client'
import { businessDisplayName } from '@/lib/business-name'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { chooseStaffToLink } from '@/lib/invites/link'
import { memberEmailsForBusiness } from '@/lib/invites/member-emails'
import { requireCapability } from '@/lib/auth/require-permission'
import { resolveStoreScope, staffWriteInScope } from '@/lib/auth/store-scope'
import {
  createInviteCore,
  listInvitesWithClient,
  reinviteTargetStaffIdWithClient,
  revokeInviteCore,
  type InviteClient,
} from '@/lib/invites/invites.core'
import { auditWeb, resolveWebActorId, resolveWebAuditContext } from '@/lib/audit-web'
import { synqedRoleToPreset } from '@/lib/auth/permissions'
import { inviteSchema, type InviteInput, type InviteRole } from '@/lib/validations/invite'

// Type ALIAS, not an `export type { … }` re-export: Next's 'use server'
// transform registers every export NAME as a server reference at runtime, and
// a re-exported type name has no runtime binding → ReferenceError at build
// (the same note sits over MarkNoShowResult in src/actions/appointments.ts).
// The row shape lives with listInvitesWithClient, its only producer.
export type InviteRow = import('@/lib/invites/invites.core').InviteRow

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
): Promise<{ token: string; storeUnknown?: true } | { error: string }> {
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

  // Actor store scope on a RE-INVITE only. A staffId here names an EXISTING
  // staff card, and acceptInvite rewrites that card's user_id (chooseStaffToLink
  // → staff.update) — so an out-of-scope re-invite hands another branch's staff
  // record, and its history, to a login of the actor's choosing. Fresh invites
  // (no staffId) are untouched: they add nobody to any store yet.
  //
  // Placed AFTER the schema parse, unlike #715's clamp-before-parse routes:
  // there the target rides the URL, here `staffId` IS an input field, so there
  // is no target to clamp until the input is parsed. Nothing is written first.
  //
  // A machine code, not a translated message: this module is in /join's
  // import graph (acceptInvite), and the i18n closure guard
  // (i18n-client-messages-closure.test.ts) holds that PRE-AUTH bundle down to
  // the `invite` namespace — a getTranslations('settings') here would drag the
  // whole settings dictionary into it. Same precedent as STAFF_LIMIT_REACHED
  // below; InviteStaffDialog maps the code to the existing
  // settings.staffStoreScopeDenied copy.
  if (parsed.data.staffId) {
    const inScope = await staffWriteInScope({
      targetStaffId: parsed.data.staffId,
      actorId: await resolveWebActorId(),
    })
    if (!inScope) return { error: 'STORE_SCOPE_DENIED' }
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
  // ⚖ Liam 2026-09-16: a fresh invite mints the card, so the same
  // creator-subset rule the 追加 door applies has to reach this door too.
  // ⚖ Liam 2026-09-16 (fold round 2, F7): `degraded ? [] : allowedStoreIds`.
  // `allowedStoreIds` is null when the staff_stores lookup FAILED, and null
  // means UNCLAMPED here — so during a core blip a 銀座-only creator would
  // silently become able to place a new hire in 代官山. `[]` refuses every
  // store instead. This is the file's own sibling convention (staffWriteInScope
  // returns false on degraded) and what the facade twin already does by
  // throwing. A WRITE fails closed on an unknown; only the read plane doesn't.
  // ⚖ FOLD ROUND 3 (fresh-eyes F6) — and a THROW is the same unknown. Every
  // other risky call in this action is guarded; this one was not, so a core
  // blip turned a hire into an unhandled Server Action error (message stripped
  // in production — the exact contract staff-action-error-contract pins). The
  // file's own sibling viewerScopeForActs catches and returns [] for this.
  const scope = await resolveStoreScope().catch(() => null)
  const allowedStoreIds = scope === null || scope.degraded ? [] : scope.allowedStoreIds
  const result = await createInviteCore(
    synqed,
    businessId,
    {
      actorId,
      source: 'web',
      requestId: crypto.randomUUID(),
      creatorAllowedStoreIds: allowedStoreIds,
    },
    invitedBy,
    parsed.data,
  )
  if ('token' in result) updateTag('staff-invites')
  return result
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
    const actorId = await resolveWebActorId()
    // A THROWN lens collapses the WHOLE list to [] through the catch below
    // (fresh invites included), where the facade drops only the row it could
    // not judge. Both fail closed; the shapes differ because web's action
    // contract is "degrade to []" and the facade's is per-row.
    return await listInvitesWithClient(
      synqed,
      await memberEmailsForBusiness(businessId),
      (targetStaffId) => staffWriteInScope({ targetStaffId, actorId }),
      actorId,
    )
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

  let synqed: InviteClient
  try {
    synqed = await getSynqedClient()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unknown error' }
  }
  const { actorId, businessId } = await resolveWebAuditContext()

  // The revoke half of createInvite's clamp — same actor, same surface, same
  // law. A clamped staff.invite holder must not cancel another branch's
  // pending RE-invite (its target card is that branch's staff record). Fresh
  // invites carry no invited_staff_id, so there is nothing to scope by.
  // Machine code for the same bundle reason as createInvite's (this module
  // rides /join's import graph — the dialog maps it to the settings copy).
  //
  // Skipped entirely for a cross-store actor: the clamp free-passes viewAll,
  // so core has no invites.get and the LIST that feeds it is pure cost there —
  // and a failed lookup must never block a revoke that was never clampable.
  // resolveStoreScope is request-cached, so this costs nothing extra.
  try {
    if (!(await resolveStoreScope()).viewAll) {
      const targetStaffId = await reinviteTargetStaffIdWithClient(synqed, id, actorId)
      if (targetStaffId && !(await staffWriteInScope({ targetStaffId, actorId }))) {
        return { error: 'STORE_SCOPE_DENIED' }
      }
    }
  } catch {
    // Fail closed on an unreadable lookup — the same answer the revoke itself
    // would give with core unreachable, and never a silent pass.
    return { error: 'Could not revoke invite.' }
  }

  const result = await revokeInviteCore(
    synqed,
    businessId,
    { actorId, source: 'web', requestId: crypto.randomUUID() },
    id,
  )
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

  // Salon name = the shared truth chain (business-name.ts): configured org
  // 事業所名 first — NOT the owner's editable profile name (the 7/26 rename
  // silently retitled this screen) — then the signup-captured name for
  // pre-onboarding tenants, then 'Karute'. Outage posture: a core failure
  // degrades to 'Karute' (never the personal profile name, never blocks
  // joining — the chain's failure contract).
  let salonName = 'Karute'
  try {
    salonName = await businessDisplayName(
      newSynqedClient(invite.business_id),
      invite.business_id,
      'Karute',
    )
  } catch {
    /* core unreachable — the default renders; next load self-corrects */
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
  // One id for every audit row this single accept-invite call can produce
  // (the happy path plus its two best-effort failure branches below).
  const requestId = crypto.randomUUID()

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
      requestId,
    })
  }

  // The join is real from here (steps 4–5 are best-effort): the invitee became
  // a member of the business, actor = the new account itself (no session yet,
  // so the ids are passed explicitly).
  //
  // EMITTED AFTER THE CORE LINK, never before: core resolves a row's
  // `actor_label` at WRITE time from its staff roster by user id, so a
  // staff.add written before step 4 attached this userId to a staff row
  // snapshots an empty label — and the row that records someone JOINING
  // reads 不明 forever once they leave. Step 4 is best-effort and its failure
  // path emits its own staff.link_failed, so this line still lands on both
  // branches; only its position moved.
  await auditWeb({
    category: 'staff',
    action: 'staff.add',
    actorId: userId,
    businessId: invite.business_id as string,
    targetType: 'staff',
    targetId: userId,
    detail: { via: 'invite', invite_id: invite.id as string, role },
    requestId,
  })

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
      requestId,
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
