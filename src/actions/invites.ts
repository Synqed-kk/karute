'use server'

import { randomBytes } from 'crypto'
import { redirect } from 'next/navigation'
import { updateTag } from 'next/cache'
import { SynqedClient } from '@synqed-kk/client'

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { getSynqedClient, newSynqedClient } from '@/lib/synqed/client'
import { businessDisplayName } from '@/lib/business-name'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { chooseStaffToLink } from '@/lib/invites/link'
import { requireCapability } from '@/lib/auth/require-permission'
import { resolveStoreScope, staffWriteInScope } from '@/lib/auth/store-scope'
import { audit } from '@/lib/audit'
import {
  INVITE_ALREADY_PENDING,
  INVITE_NAME_REQUIRED,
  STAFF_CREATE_FAILED,
} from '@/lib/auth/store-gate'
import {
  createAndPlaceStaffCard,
  STAFF_CARD_LEFT_BEHIND,
  type NewCardClient,
} from '@/lib/staff/new-card'
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
type InviteClient = Pick<SynqedClient, 'invites'> &
  // ⚖ Liam 2026-09-16: a FRESH invite mints the staff card first, through the
  // same placement path createStaff uses — so the core needs the staff ports
  // too. Partial, because every RE-invite path works without them.
  Partial<Pick<SynqedClient, 'staff' | 'staffStores' | 'stores'>>

/** Identity + provenance a Bearer/cookie caller feeds an invite write core. */
type InviteWriteDeps = {
  actorId: string | null
  source: 'web' | 'facade'
  /** ⚖ Liam 2026-09-16 — the CREATOR's own allowed stores, resolved by each
   *  transport from its own identity. A fresh invite's card can only be placed
   *  inside them; the rule itself lives in setStaffStoresAtCreationCore, the
   *  one home both the staff door and this one share. `null` = unclamped. */
  creatorAllowedStoreIds: readonly string[] | null
  /** PR-M5 piece ④: minted at the web action boundary / read off ctx.meta on
   *  the facade twin. */
  requestId?: string
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

/** Every invite row this business holds, or `null` when the list could not be
 *  read. try/catch, not `.catch()`: a client with no invites port at all is the
 *  same UNKNOWN as a failed call (the idiom new-card.ts uses for the store
 *  count). Both callers treat UNKNOWN as "carry on" — neither the duplicate
 *  refusal nor the orphan cleanup may block the act it rides on. */
async function inviteRowsQuietly(synqed: InviteClient): Promise<
  {
    id: string
    email: string
    status: string
    invited_staff_id: string | null
    created_at: string
  }[] | null
> {
  try {
    return (await synqed.invites.list()).invites
  } catch {
    return null
  }
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
): Promise<{ token: string; storeUnknown?: true } | { error: string }> {
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

  // ⚖ FOLD ROUND 3 (fresh-eyes F4) — ONE PENDING FRESH INVITE PER EMAIL.
  // A fresh invite MINTS a card, so inviting the same new hire twice left two:
  // accept wires one and the other is permanent, named, and eating a plan seat.
  // The check above only sees people who already have a login here — a brand-new
  // hire has none, which is the whole point of the door. Re-invites are exempt:
  // they attach to a card that already exists and mint nothing.
  //
  // Best-effort by design: an unreadable invite list must NEVER block hiring
  // (the same posture as the store-count read in new-card.ts). The worst case
  // during a core blip is the duplicate we had before this fold.
  if (!staffId) {
    const openInvites = await inviteRowsQuietly(synqed)
    const already = openInvites?.some(
      (i) => i.status === 'pending' && i.email.toLowerCase() === email.toLowerCase(),
    )
    if (already) return { error: INVITE_ALREADY_PENDING }
  }

  // ⚖ Liam 2026-09-16 — A FRESH INVITE MAKES THE CARD FIRST.
  //
  // Before this, an email-only invite carried no staff row at all: the card was
  // minted on ACCEPT, with no store, and the new hire's first login landed them
  // on another branch's data (now: on the honest empty screen — still wrong for
  // the person's first day). So the card is created HERE, with a real name and
  // a real store, and the invite carries its id as `invited_staff_id` — which
  // means accept attaches the login through the EXISTING re-invite path
  // (chooseStaffToLink → staff.update), with no change to acceptInvite at all.
  //
  // NEVER an email-named card: a fresh invite with no name is refused outright.
  // The store rule is not spelled here either — createStaffCore owns it, so the
  // invite door and the 追加 door enforce one rule, including the
  // creator-subset check and the delete-the-card-if-placement-fails rollback.
  let mintedStaffId: string | null = null
  let mintedStoreUnknown = false
  if (!staffId) {
    if (!input.name) return { error: INVITE_NAME_REQUIRED }
    // ⚖ G6 — THE MINT STAYS INSIDE THE CONTRACT. Both ways the card can fail
    // to exist answer with the same machine code the dialog already knows how
    // to speak: the client with no staff port (an English literal before), and
    // a core rejection on staff.create — which used to escape this action
    // entirely as an unhandled Server Action error, its message stripped in
    // production, leaving the owner with nothing to read.
    if (!synqed.staff) return { error: STAFF_CREATE_FAILED }
    let card: { id: string; storeUnknown?: true } | { error: string }
    try {
      card = await createAndPlaceStaffCard(
        synqed as NewCardClient,
        businessId,
        {
          actorId: deps.actorId,
          source: deps.source,
          requestId: deps.requestId,
          creatorAllowedStoreIds: deps.creatorAllowedStoreIds,
        },
        // user_id null by construction: the existing-member check above just
        // proved this email has no login in this business. acceptInvite fills
        // it in through the re-invite path.
        { name: input.name, email, userId: null, storeIds: input.storeIds ?? [] },
      )
    } catch (err) {
      console.error('[createInvite] could not create the staff card:', err)
      return { error: STAFF_CREATE_FAILED }
    }
    if ('error' in card) return { error: card.error }
    mintedStaffId = card.id
    mintedStoreUnknown = !!card.storeUnknown
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString()

  let created: { id?: string }
  try {
    created = await synqed.invites.create({
      email,
      role,
      token,
      invited_by: invitedBy,
      invited_staff_id: staffId ?? mintedStaffId,
      expires_at: expiresAt,
    })
  } catch (e) {
    // Roll the card back: a card whose invite never existed is exactly the
    // floating card this whole change removes, and nobody would know to delete
    // it. Same posture as createStaffCore's own placement rollback.
    // ⚖ FOLD ROUND 3 (fresh-eyes F8): a FAILED rollback is SAID OUT LOUD. The
    // delete's own error used to reach console.error only, so the caller heard
    // about the invite while a card nobody knows about sat on the roster.
    if (mintedStaffId && synqed.staff) {
      try {
        await synqed.staff.delete(mintedStaffId)
      } catch (err) {
        // ⚖ G8 — the twin of new-card.ts's rollback trace: the id in the log
        // line, and a warning row so 監査ログ carries the orphan too.
        console.error('[createInvite] rollback of an inviteless card failed:', mintedStaffId, err)
        audit({
          category: 'staff',
          action: 'staff.add',
          severity: 'warning',
          actorId: deps.actorId,
          actorType: 'staff',
          businessId,
          targetType: 'staff',
          targetId: mintedStaffId,
          detail: { reason: 'rollback_failed', placement_error: 'invite_create_failed' },
          requestId: deps.requestId,
          source: deps.source,
        })
        return { error: STAFF_CARD_LEFT_BEHIND }
      }
    }
    return { error: `Could not create invite: ${e instanceof Error ? e.message : 'unknown error'}` }
  }

  // ⚖ J4 — the invite now exists, so the card will stay. A successful
  // rollback emits nothing; a failed rollback has its own single warning.
  if (mintedStaffId) {
    audit({
      category: 'staff',
      action: 'staff.add',
      severity: mintedStoreUnknown ? 'notice' : 'info',
      actorId: deps.actorId,
      actorType: 'staff',
      businessId,
      targetType: 'staff',
      targetId: mintedStaffId,
      detail: mintedStoreUnknown ? { reason: 'store_count_unknown_unplaced' } : undefined,
      requestId: deps.requestId,
      source: deps.source,
    })
  }

  // ids only — the invite email is deliberately NOT logged (PII-free sink rule).
  audit({
    category: 'staff',
    action: 'staff.invite_create',
    actorId: deps.actorId,
    actorType: 'staff',
    businessId,
    targetType: staffId || mintedStaffId ? 'staff' : undefined,
    targetId: staffId ?? mintedStaffId ?? undefined,
    detail: { invite_id: created.id ?? null, role, reinvite: !!staffId },
    requestId: deps.requestId,
    source: deps.source,
  })

  if (mintedStoreUnknown) return { token, storeUnknown: true }
  return { token }
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

/** Client-threaded core of listInvites (facade Bearer path, design-parity
 *  packet 12 §S4b). Never throws — degrades to [] the same way the web
 *  action's own catch does. */
export async function listInvitesWithClient(
  synqed: InviteClient,
  memberEmails?: Set<string>,
  /** Store lens for RE-INVITE rows (isolation law: HIDE, never
   *  show-and-refuse — a row the revoke clamp below would refuse must not be
   *  on screen at all). Each transport passes its own clamp because the two
   *  resolve the actor from different identities: web's cookie
   *  staffWriteInScope, the facade's Bearer ensureStaffWriteInScope. Omitted
   *  = unfiltered, the shape every pre-clamp caller had.
   *
   *  ⚖ FOLD ROUND 3 (fresh-eyes F5) — THE WIDENING, STATED. That lane is this
   *  branch: a fresh invite now MINTS its card, so fresh rows carry an
   *  invited_staff_id and go through this lens like any re-invite. That is the
   *  rule now — a pending invite is visible to whoever may write to the card it
   *  points at.
   *
   *  With ONE exception, `selfStaffId`: the person who CREATED the invite keeps
   *  it on their own pending list. A card minted during a core blip can end up
   *  with no store at all (the "an unreadable store list never blocks hiring"
   *  arm), and a store-clamped creator would otherwise lose sight of the invite
   *  they had just sent, with no way to cancel it. The revoke clamp free-passes
   *  the same rows for the same reason (reinviteTargetStaffIdWithClient) —
   *  never show-and-refuse. */
  canSeeReinvite?: (staffId: string) => Promise<boolean>,
  /** The VIEWER's own staff id, so their own invites stay on their list. */
  selfStaffId?: string | null,
): Promise<InviteRow[]> {
  try {
    const { invites } = await synqed.invites.list()
    let pending = invites.filter((i) => i.status === 'pending')
    if (canSeeReinvite) {
      // ponytail: one clamp call per re-invite row, and on the facade each
      // call re-resolves the ACTOR (staffStores.get) before reading the
      // target's — so a clamped viewer pays ~2 core reads per re-invite row,
      // plus one uncached roster read whenever their assignment comes back
      // empty. Ceiling accepted: a pending list is a handful of rows. Hoist
      // path when it stops being true: resolve the actor's scope ONCE outside
      // the loop and pass allowedStoreIds down, leaving one staffStores.get
      // per row (queued, not built).
      const visible = await Promise.all(
        pending.map((i) =>
          i.invited_staff_id && !(selfStaffId && i.invited_by === selfStaffId)
            ? canSeeReinvite(i.invited_staff_id)
            : Promise.resolve(true),
        ),
      )
      pending = pending.filter((_, idx) => visible[idx])
    }
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

/** The staff card a pending invite RE-ACTIVATES, or null for a fresh
 *  (email-only) one. Core has no invites.get, so the list IS the lookup —
 *  the same read listInvites already makes, and cheap next to the write it
 *  guards. An id absent from the list is null: there is nothing to clamp and
 *  the revoke's own core error answers it. A THROWN lookup is left to the
 *  caller to fail closed on — an invite whose target cannot be read is one
 *  nothing can be vouched for. Exported for the facade twin (same explicit-
 *  client seam as revokeInviteCore). */
export async function reinviteTargetStaffIdWithClient(
  synqed: InviteClient,
  id: string,
  /** The CALLER's own staff id. An invite they created themselves has nothing
   *  to clamp: it is on their own pending list (listInvitesWithClient's same
   *  free-pass), and cancelling it adds nobody to any store — ⚖ fold round 3,
   *  fresh-eyes F5. Without the pair, a clamped creator sees an invite they
   *  cannot cancel, which is the show-and-refuse the isolation law forbids. */
  selfStaffId?: string | null,
): Promise<string | null> {
  const { invites } = await synqed.invites.list()
  const invite = invites.find((i) => i.id === id)
  if (!invite) return null
  if (selfStaffId && invite.invited_by === selfStaffId) return null
  return invite.invited_staff_id ?? null
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
    requestId: deps.requestId,
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
    { actorId, source: 'web', requestId: crypto.randomUUID(), creatorAllowedStoreIds: [] },
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
