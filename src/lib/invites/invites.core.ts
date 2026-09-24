import 'server-only'

// The four client-threaded invite cores, moved out of src/actions/invites.ts
// (PKT-SEC-CORES-B1, 2026-09-23). Every runtime export of a 'use server'
// module is registered as a browser-callable server action with no
// authentication of its own — and passing a client object as the first
// argument is no barrier, because the reply decoder revives nested
// references. These four are INTERNAL helpers: they take an already-scoped
// client and trust the caller to have gated the request. They live here, in a
// server-only module with NO directive, so the only way in is a server-side
// import — the web actions in src/actions/invites.ts and the facade routes
// under src/app/api/app/v1/invites/.

import { randomBytes } from 'crypto'
import type { SynqedClient } from '@synqed-kk/client'

import { createServiceClient } from '@/lib/supabase/service'
import { audit, auditDurable } from '@/lib/audit'
import {
  INVITE_ALREADY_PENDING,
  INVITE_NAME_REQUIRED,
  INVITE_ROLE_EXCEEDS_CALLER,
  STAFF_CREATE_FAILED,
} from '@/lib/auth/store-gate'
import { ROLE_PRESETS, synqedRoleToPreset, type Capability } from '@/lib/auth/permissions'
import {
  createAndPlaceStaffCard,
  STAFF_CARD_LEFT_BEHIND,
  type NewCardClient,
} from '@/lib/staff/new-card'
import {
  type InviteInput,
  type InviteRole,
  INVITE_TTL_DAYS,
} from '@/lib/validations/invite'

// Explicit-client seam (design-parity packet 12 §S4b — the P-B pattern, same
// as the S4a cores): the cores below take this instead of resolving
// getSynqedClient() from the cookie session, so the facade (Bearer path) and
// the web actions run the IDENTICAL write logic.
export type InviteClient = Pick<SynqedClient, 'invites' | 'audit'> &
  // ⚖ Greptile #978 R1 (F3): `audit` is REQUIRED — the revoke proves which
  // card a fresh invite minted by reading OUR append-only ledger (the J4
  // staff.add row carries minted_by_invite_id), not by guessing from a clock.
  // ⚖ Liam 2026-09-16: a FRESH invite mints the staff card first, through the
  // same placement path createStaff uses — so the core needs the staff ports
  // too. Partial, because every RE-invite path works without them.
  Partial<Pick<SynqedClient, 'staff' | 'staffStores' | 'stores'>>

/** Identity + provenance a Bearer/cookie caller feeds an invite write core. */
type InviteWriteDeps = {
  actorId: string | null
  source: 'web' | 'facade'
  /** PR-M5 piece ④: minted at the web action boundary / read off ctx.meta on
   *  the facade twin. */
  requestId?: string
}

export type InviteCreateDeps = InviteWriteDeps & {
  /** REQUIRED on purpose: `null` = EXPLICITLY unclamped; omitted is not unclamped (see lib/staff/new-card.ts). */
  creatorAllowedStoreIds: readonly string[] | null
  /** The inviter's own effective capabilities — enforces "you can only invite
   *  into a role whose preset you hold yourself", the same shape and rule as
   *  PermissionsWriteDeps.callerCapabilities. Absent = refused. */
  callerCapabilities: Set<Capability>
}

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

/** An invite row's instant, or −∞ when core sent something unparseable — so an
 *  unreadable stamp can never outrank a real one (⚖ I5). */
function stampOf(row: { created_at?: string | null }): number {
  const n = Date.parse(row.created_at ?? '')
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY
}

/** Is `inviteId` the NEWEST LIVE invite pointing at `cardId` — counting the
 *  ones already ACCEPTED? (⚖ H1, correcting G2.) Three answers:
 *  'newest' · 'superseded' · 'unknown' (the list could not be read).
 *
 *  It used to count pending rows only, which broke it in the exact case it
 *  exists for: acceptInvite marks an invite 'accepted' at the very END, after
 *  the link step, so once the newer invite B has been through, B is no longer
 *  pending. A stale A opened later then found pending = [A], called itself the
 *  newest, and re-pointed the card B had just wired. A REVOKED row is the only
 *  one that stops counting — it was deliberately cancelled.
 *
 *  The list IS the lookup — core has no invites.get, and this is the same read
 *  the revoke clamp already makes.
 *
 *  ⚖ Greptile #978 R1 (F2) — REVERSED: an UNREADABLE list used to answer YES
 *  ("a core blip must never turn a legitimate join into a refusal"). That let
 *  the same stale token OVERWRITE a card already wired to someone else during
 *  an outage. It now answers 'unknown', and acceptInvite refuses a WIRED card
 *  on 'unknown' before any account exists (the invitee can simply retry). An
 *  unwired card never reaches this read at all, so a blip still cannot block
 *  an ordinary join. No live rows / only this row = 'newest'. */
export async function isNewestLiveInviteForCard(
  synqed: InviteClient,
  inviteId: string,
  cardId: string,
): Promise<'newest' | 'superseded' | 'unknown'> {
  const rows = await inviteRowsQuietly(synqed)
  if (!rows) return 'unknown'
  const live = rows.filter((i) => i.status !== 'revoked' && i.invited_staff_id === cardId)
  if (live.length === 0) return 'newest'
  const mine = live.find((i) => i.id === inviteId)
  if (!mine) return 'superseded'
  const mineAt = stampOf(mine)
  // ⚖ I5 — ONE SPELLING OF "NEWER". String compare read '…T18:00:00+09:00' as
  // later than '…T10:00:00Z' although it is an hour EARLIER; two spellings of
  // "newer" in one file is two chances to disagree. THE TIE RULE: strictly
  // newer than every other live row. An exact tie does NOT make this invite
  // the newest — with two rows at the same instant nothing says which was
  // meant, and the safe answer is "do not re-point the card"; being the ONLY
  // live row is the exception, and it passes vacuously. An UNPARSEABLE stamp
  // never outranks a parseable one (it sorts below every real instant).
  return live.every((i) => i.id === inviteId || stampOf(i) < mineAt) ? 'newest' : 'superseded'
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
  deps: InviteCreateDeps,
  invitedBy: string | null,
  input: InviteInput,
): Promise<{ token: string; storeUnknown?: true } | { error: string }> {
  const { email, role, staffId } = input

  // Hold what you grant, before ANY read or write. Accepting the invite seeds
  // the person with the role's FULL preset (synqedRoleToPreset → ROLE_PRESETS),
  // so the inviter must hold every capability in it — for all three roles:
  // ADMIN = the manager preset, STYLIST adds records.write over ASSISTANT.
  // Creation only: an invite already minted is not re-checked at accept (the
  // 7-day TTL bounds that gap).
  const held = deps.callerCapabilities
  if (!held || ROLE_PRESETS[synqedRoleToPreset(role)].some((c) => !held.has(c))) {
    return { error: INVITE_ROLE_EXCEEDS_CALLER }
  }

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

  let created: { id?: string; created_at?: string }
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
  //
  // ⚖ Greptile #978 R1 (F3) — THIS ROW IS THE PROVENANCE. Core has no field
  // for "this invite minted this card", so the row names the invite
  // (minted_by_invite_id) and is written DURABLY (awaited): revokeInviteCore
  // reads it back from the append-only ledger before it will switch a card
  // off. A failed durable write only means provenance is unproven — the card
  // is then simply kept at revoke, with the notice row saying so.
  if (mintedStaffId) {
    try {
      const landed = await auditDurable({
        category: 'staff',
        action: 'staff.add',
        severity: mintedStoreUnknown ? 'notice' : 'info',
        actorId: deps.actorId,
        actorType: 'staff',
        businessId,
        targetType: 'staff',
        targetId: mintedStaffId,
        detail: {
          ...(mintedStoreUnknown ? { reason: 'store_count_unknown_unplaced' } : {}),
          minted_by_invite_id: created.id ?? null,
        },
        requestId: deps.requestId,
        source: deps.source,
      })
      if (!landed.ok) {
        console.error('[createInvite] the mint row did not land — provenance unproven:', mintedStaffId)
      }
    } catch (err) {
      // auditDurable never throws by contract; this only keeps the file's own
      // rule (auditing never breaks the act it records) if that ever changes.
      console.error('[createInvite] the mint row did not land — provenance unproven:', mintedStaffId, err)
    }
  }

  // ⚖ G2 — ONE PENDING INVITE PER CARD. A card can be aimed at by more than one
  // live invite: a fresh invite mints card X, then the same person is re-invited
  // (new address, lost login) — and now TWO tokens can each wire X to a
  // DIFFERENT account, last one in wins, silently. The invite just written is
  // the deliberate one, so every OTHER pending invite for the same card is
  // cancelled here, through the same updateStatus + staff.invite_revoke row a
  // manual cancel writes (no new audit action).
  //
  // Best-effort, AFTER the new invite exists: an unreadable invite list must
  // never block hiring (the file's own posture, see inviteRowsQuietly), and the
  // accept-side guard is the backstop for exactly that case.
  //
  // ⚖ Greptile #978 R1 (F5) — THE NEWER INVITE WINS; an older one never
  // cancels a newer one. Only STRICTLY OLDER pending rows are revoked, so two
  // concurrent re-invites for one card can no longer cancel each other: the
  // older request finds the newer row and leaves it; the newer one revokes the
  // older. A tie revokes nothing (nothing says which was meant — the
  // accept-side guard is the backstop).
  const targetCardId = staffId ?? mintedStaffId
  const createdAt = stampOf(created)
  if (targetCardId && !created.id) {
    // ⚖ I3 — NEVER REVOKE WHAT WE CANNOT EXCLUDE. The self-exclusion below is
    // `row.id === created.id`; with no id back from core that test can never
    // fire, and the loop would cancel the very invite it just wrote. Skip the
    // whole supersede instead — the accept-side guard is the backstop.
    console.error('[createInvite] core returned no invite id — skipping the supersede')
  } else if (targetCardId && !Number.isFinite(createdAt)) {
    // Same shape as I3: never revoke what we cannot ORDER. With no readable
    // stamp on the new row, "strictly older" cannot be decided.
    console.error('[createInvite] core returned no readable invite created_at — skipping the supersede')
  } else if (targetCardId) {
    for (const row of (await inviteRowsQuietly(synqed)) ?? []) {
      if (row.status !== 'pending' || row.invited_staff_id !== targetCardId) continue
      if (row.id === created.id) continue
      if (!(stampOf(row) < createdAt)) continue
      try {
        await synqed.invites.updateStatus(row.id, 'revoked')
      } catch (err) {
        console.error('[createInvite] could not cancel a superseded invite:', err)
        continue
      }
      audit({
        category: 'staff',
        action: 'staff.invite_revoke',
        actorId: deps.actorId,
        actorType: 'staff',
        businessId,
        targetType: 'staff',
        targetId: targetCardId,
        detail: { invite_id: row.id, reason: 'superseded_by_new_invite' },
        requestId: deps.requestId,
        source: deps.source,
      })
    }
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

/** Only a successful, empty target assignment read proves a card storeless. */
async function targetCardIsStoreless(synqed: InviteClient, staffId: string): Promise<boolean> {
  try {
    if (!synqed.staffStores) return false
    const { store_ids } = await synqed.staffStores.get(staffId)
    return Array.isArray(store_ids) && store_ids.length === 0
  } catch {
    return false
  }
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
   *  With ONE exception, `selfStaffId`: the creator keeps their own invite
   *  only while its target card has a confirmed empty store assignment list.
   *  A card minted during a core blip can have no store, and its clamped
   *  creator must still see and cancel that invite. A placed card goes through
   *  the normal lens even for its creator. Missing, failed or malformed reads
   *  are UNKNOWN, not storeless, so they also go through the lens. The revoke
   *  clamp uses the same exception (reinviteTargetStaffIdWithClient) — never
   *  show-and-refuse. */
  canSeeReinvite?: (staffId: string) => Promise<boolean>,
  /** The VIEWER's own staff id, for the storeless-target exception only. */
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
        pending.map(async (i) => {
          if (!i.invited_staff_id) return true
          if (
            selfStaffId && i.invited_by === selfStaffId &&
            await targetCardIsStoreless(synqed, i.invited_staff_id)
          ) return true
          return canSeeReinvite(i.invited_staff_id)
        }),
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
  /** The CALLER's own staff id. Their invite has nothing to clamp ONLY while
   *  its target has a confirmed empty store assignment list: a card minted
   *  during a core blip must remain cancellable by its creator, matching
   *  listInvitesWithClient's visibility exception. A placed card goes through
   *  the normal lens even for its creator. Missing, failed or malformed reads
   *  are UNKNOWN, not storeless, so return the target for the normal clamp. */
  selfStaffId?: string | null,
): Promise<string | null> {
  const { invites } = await synqed.invites.list()
  const invite = invites.find((i) => i.id === id)
  if (!invite) return null
  if (
    invite.invited_staff_id && selfStaffId && invite.invited_by === selfStaffId &&
    await targetCardIsStoreless(synqed, invite.invited_staff_id)
  ) return null
  return invite.invited_staff_id ?? null
}

/** How far either side of the card's own birth the ledger is searched for its
 *  mint row. The row is written moments after the card, in the same call; ten
 *  minutes each way only bounds the read, it proves nothing by itself. */
const MINT_ROW_SEARCH_MS = 10 * 60_000

/**
 * Was this card MINTED BY THIS INVITE? (⚖ G5, re-grounded by Greptile #978 R1 F3.)
 *
 * Provenance comes from OUR LEDGER, not a clock. createInviteCore writes the
 * fresh invite's staff.add row durably with `minted_by_invite_id` = the invite
 * it created, and the audit log is append-only — so the answer is YES only
 * when a staff.add row for this card names THIS invite. Only that card is ever
 * switched off. A read failure, no row, a row naming another invite, or a card
 * with no parseable created_at is NOT proven, and the card is kept.
 *
 * Cards minted before this ledger line existed (between #974 and this PR)
 * carry no such row: they are kept with the notice row, and the owner tidies
 * them by hand. The core ask — an explicit `minted_by_invite_id` on staff —
 * remains the final word the day it exists.
 *
 * A WIRED card is never touched, whatever the ledger says: that person has a
 * login.
 */
async function cardMintedByInvite(
  synqed: InviteClient,
  card: { id: string; user_id: string | null; created_at?: string },
  inviteId: string,
): Promise<boolean> {
  if (card.user_id != null) return false
  const born = Date.parse(card.created_at ?? '')
  if (!Number.isFinite(born)) return false
  try {
    const { events } = await synqed.audit.list({
      category: 'staff',
      target_type: 'staff',
      target_id: card.id,
      from: new Date(born - MINT_ROW_SEARCH_MS).toISOString(),
      to: new Date(born + MINT_ROW_SEARCH_MS).toISOString(),
      page_size: 50,
    })
    return events.some(
      (e) =>
        e.action === 'staff.add' &&
        (e.detail as { minted_by_invite_id?: unknown } | null)?.minted_by_invite_id === inviteId,
    )
  } catch (err) {
    console.error('[revokeInvite] could not read the mint row for the invited card:', card.id, err)
    return false
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
  // Read the row BEFORE the flip: core has no invites.get, and after it the row
  // is no longer pending. Best-effort — a revoke must never fail on this read.
  const rowsBeforeFlip = await inviteRowsQuietly(synqed)
  const invite = rowsBeforeFlip?.find((i) => i.id === id) ?? null

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

  // ⚖ FOLD ROUND 3 (fresh-eyes F4) — THE CARD THE INVITE MADE. A fresh invite
  // mints a staff card up front; revoking used to flip the invite only, leaving
  // a named, store-placed card with no login on the roster — and on the plan's
  // seat count — that nobody could explain. It goes INACTIVE, through the same
  // staff update path a manager would use, and is NEVER deleted (⚖ nothing
  // deleted, soft only): the owner can switch it back on in one tap.
  //
  // WHICH card: ⚖ G5 — the one THIS invite minted, proved by
  // cardMintedByInvite (unwired + a ledger staff.add row naming this invite,
  // ⚖ Greptile #978 R1 F3). The email match alone used to be enough, and it
  // caught an ESTABLISHED employee who had simply never logged in and was
  // re-invited at the address already on their card — cancelling would switch
  // off someone who takes bookings every day.
  //
  // Best-effort, AFTER the revoke has already succeeded and been receipted: a
  // failure here leaves exactly the orphan we had before the fold, never a
  // half-revoked invite. And NEVER silently: whenever the card is left
  // standing — not ours, unreadable, or the update itself failed — a notice
  // row names it, so 監査ログ always says what happened to the card.
  if (!invite || (invite.invited_staff_id && !synqed.staff)) {
    // ⚖ I4 — A REVOKE THAT COULD NOT LOOK SAYS SO. The pre-flip read came back
    // null (unreadable list, or an id the list does not carry), or this client
    // has no staff port: the card block below never runs, and until now that
    // left no trace at all. No target when the card id is unknown.
    audit({
      category: 'staff',
      action: 'staff.invite_revoke',
      severity: 'notice',
      actorId: deps.actorId,
      actorType: 'staff',
      businessId,
      ...(invite?.invited_staff_id
        ? { targetType: 'staff' as const, targetId: invite.invited_staff_id }
        : {}),
      detail: { invite_id: id, reason: 'invite_revoked_card_not_checked' },
      requestId: deps.requestId,
      source: deps.source,
    })
  } else if (invite.invited_staff_id && synqed.staff) {
    const cardId = invite.invited_staff_id
    // ⚖ I1 — NEVER SWITCH OFF A CARD A LIVE INVITE STILL NEEDS. Two more
    // conditions, first read off the pre-flip rows (a cheap early exit; F4
    // below re-reads right before the write):
    //   · the row was PENDING before this flip — revoking an invite that was
    //     already superseded (a stale list, the phone's own copy) must not
    //     reach the card the NEW invite is about to use;
    //   · no OTHER non-revoked invite points at that card — same harm by the
    //     other route, when the create-side supersede never ran.
    // Otherwise the card stands and the notice row says WHICH reason.
    let keptBecause: string | null = null
    if (invite.status !== 'pending') {
      keptBecause = 'invite_not_pending'
    } else if (
      (rowsBeforeFlip ?? []).some(
        (r) => r.id !== id && r.status !== 'revoked' && r.invited_staff_id === cardId,
      )
    ) {
      keptBecause = 'another_live_invite'
    } else {
      let card: { id: string; user_id: string | null; created_at?: string } | null = null
      try {
        card = await synqed.staff.get(cardId)
        if (!card) keptBecause = 'card_unreadable'
      } catch (err) {
        console.error('[revokeInvite] could not read the invited card:', cardId, err)
        keptBecause = 'card_unreadable'
      }
      if (card) {
        const proven = await cardMintedByInvite(synqed, card, id)
        // ⚖ Greptile #978 R1 (F4) — RE-READ BEFORE THE WRITE. The check above
        // ran on the pre-flip snapshot; a re-invite created since then is
        // missing from it. The window now shrinks to the gap between this read
        // and the write below; core uniqueness (the queued core ask) closes it.
        const rowsNow = proven ? await inviteRowsQuietly(synqed) : null
        if (!proven) {
          keptBecause = 'provenance_not_proven'
        } else if (rowsNow === null) {
          keptBecause = 'recheck_unreadable'
        } else if (
          rowsNow.some((r) => r.id !== id && r.status !== 'revoked' && r.invited_staff_id === cardId)
        ) {
          keptBecause = 'another_live_invite'
        } else {
          try {
            await synqed.staff.update(card.id, { is_active: false })
            audit({
              category: 'staff',
              action: 'staff.update',
              actorId: deps.actorId,
              actorType: 'staff',
              businessId,
              targetType: 'staff',
              targetId: card.id,
              detail: { is_active: false, reason: 'invite_revoked', invite_id: id },
              requestId: deps.requestId,
              source: deps.source,
            })
          } catch (err) {
            console.error('[revokeInvite] could not deactivate the invited card:', cardId, err)
            keptBecause = 'update_failed'
          }
        }
      }
    }
    if (keptBecause) {
      audit({
        category: 'staff',
        action: 'staff.invite_revoke',
        severity: 'notice',
        actorId: deps.actorId,
        actorType: 'staff',
        businessId,
        targetType: 'staff',
        targetId: cardId,
        detail: { invite_id: id, reason: 'invite_revoked_card_kept', kept_because: keptBecause },
        requestId: deps.requestId,
        source: deps.source,
      })
    }
  }

  return { ok: true }
}
