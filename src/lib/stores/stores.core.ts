import 'server-only'

// The six client-threaded store cores, moved out of src/actions/stores.ts
// (PKT-SEC-CORES-B2, 2026-09-23). Every runtime export of a 'use server'
// module is registered as a browser-callable server action with no
// authentication of its own — and passing a client object as the first
// argument is no barrier, because the reply decoder revives nested
// references. These six are INTERNAL helpers: they take an already-scoped
// client and trust the caller to have gated the request. They live here, in a
// server-only module with NO directive, so the only way in is a server-side
// import — the web actions in src/actions/stores.ts and the facade routes
// under src/app/api/app/v1/ (stores, stores/[id], stores/[id]/hours,
// staff/[id]/stores, screens/settings).

import type { SynqedClient, WeeklyHours } from '@synqed-kk/client'

import { businessDisplayName } from '@/lib/business-name'
import { WEEKDAY_KEYS } from '@/lib/operating-hours'
import { WeeklyHoursSchema } from '@/lib/app-api/settings-screen-dto'
import {
  storeSchema,
  type StoreInput,
  STORE_OWNER_DENIAL,
  STORE_HOURS_ACTOR_UNRESOLVED,
  STORE_HOURS_UNKNOWN_STORE,
  STORE_HOURS_UNREADABLE,
  parseStoreWeeklyHours,
} from '@/lib/validations/store'
import { loadEntitlementWithClient } from '@/lib/entitlements'
import { audit } from '@/lib/audit'
// The tolerant business_type reader lives beside the registry: it could not be
// declared in src/actions/stores.ts, where every export is a callable
// endpoint — and the 予約 capacity path needs the same one answer.
import { coreBusinessType } from '@/lib/welcome/business-types'

// Explicit-client seam (design-parity packet 12 §B-3 S2 — the P-B pattern):
// every twin below takes this instead of resolving getSynqedClient() from the
// cookie session, so the facade (Bearer path, business resolved from the
// verified token) and the web actions run the IDENTICAL write/read logic.
export type StoresClient = Pick<
  SynqedClient,
  'stores' | 'staffStores' | 'customers' | 'entitlements' | 'orgSettings' | 'storePolicies'
> &
  Partial<Pick<SynqedClient, 'staff'>>

/** Roster row shape the owner gate needs — a subset of StaffMember so the
 *  twin doesn't import the whole staff module's type surface. */
export type RosterRow = { id: string; display_role?: string | null }

/** Pure owner-roster check — the ONE place "is this caller the salon owner"
 *  is decided, shared by every write core below (fed the same roster +
 *  resolved auth id via deps, cookie-resolved on web / Bearer-resolved on
 *  the facade). */
function isRosterOwner(staffList: RosterRow[], selfUserId: string | null): boolean {
  return (
    !!selfUserId &&
    staffList.some((s) => s.id === selfUserId && (s.display_role ?? '').toLowerCase() === 'owner')
  )
}

/** Identity + provenance a Bearer/cookie caller feeds the write cores: the
 *  roster (for the owner check), the resolved caller id (owner check +
 *  audit actor), and which path is calling (the audit event's `source`). */
export type StoreWriteDeps = {
  staffList: RosterRow[]
  selfUserId: string | null
  source: 'web' | 'facade'
  /** PR-M5 piece ④: minted at the web action boundary / read off ctx.meta on
   *  the facade twin. */
  requestId?: string
}

export interface StoreRow {
  id: string
  name: string
  address: string | null
  phone: string | null
  isPrimary: boolean
  active: boolean
  staffCount: number
  customerCount: number
  /** This location's vertical (BUSINESS_TYPES value). Null until core's
   *  stores.business_type column exists / backfills (brief 2026-07-08). */
  businessType: string | null
  /** This store's own weekly opening hours (core `storePolicies.weekly_hours`).
   *  THREE states, deliberately: `undefined` = this read never asked for hours
   *  (`opts.withHours` false — the app-shell layout's read); `null` = asked, and
   *  the store has never configured any, so the business-wide 営業時間 answers
   *  for it (resolveDayHours, src/lib/operating-hours.ts); an object = the
   *  store's own week. A consumer must not read `undefined` as "none". */
  weeklyHours?: WeeklyHours | null
  /** A stored week exists but this app cannot read it; null hours with this
   *  flag must never be treated as unconfigured or offered for overwrite. */
  weeklyHoursUnreadable?: boolean
}

// Primary-store name = the shared truth chain (business-name.ts). This write
// is PERMANENT (the provisioned 本店 keeps it, nothing re-syncs it later) and
// fires on the FIRST authenticated render — usually BEFORE /welcome writes
// org settings — so the signup-captured tier is the one most new tenants
// actually hit. 'Main store' only when both sources are empty.

/** Client-threaded core of listStores (facade Bearer path, design-parity
 *  packet 12 §B-3 S2 — same WithClient split as orgSettingsWithClient).
 *  BYTE-PARITY with the pre-S2 web-only listStores body (810e4b6d): list +
 *  BOTH per-store count maps, merged, AND (when `opts.ensurePrimary`) the
 *  lazy 本店-create — web always performed this write, and callers that opt
 *  in provision a brand-new tenant's primary store the same way. Race-
 *  tolerant: the unique index in core blocks a 2nd primary, so a losing
 *  create is ignored and the caller still gets the winner's row.
 *
 *  `ensurePrimary` is explicit at every call site (no default) — this write
 *  is reachable via GET-classified facade keys, so which keys can trigger it
 *  must stay visible at the call site, not buried in a default. Any facade
 *  GET that passes `true` MUST carry its endpoint key in
 *  REVOCATION_SENSITIVE_ENDPOINTS (src/lib/auth/revocation.ts) — the method-
 *  scan coverage test can't see a write hidden under a GET, so
 *  GET_ENDPOINTS_WITH_WRITE_SIDE_EFFECTS in
 *  app-api-revocation-coverage.test.ts is the maintained registry for it. */
export async function listStoresWithClient(
  synqed: StoresClient,
  businessId: string,
  opts: { ensurePrimary: boolean; withHours?: boolean },
): Promise<StoreRow[]> {
  // Fetch the store list AND both per-store count maps in one parallel batch —
  // they're independent reads, so there's no reason to await them in series
  // (3 back-to-back round-trips → 1; the settings 店舗 list felt this as a
  // visible lag before the second store appeared). Each count map stays
  // resilient: a core that can't serve it degrades to an empty map (→ 0)
  // instead of throwing.
  //   - staff counts: core's staff_stores link table.
  //   - customer counts: distinct customers with >=1 event at the store, derived
  //     server-side (customers stay business-wide). The heaviest of the three.
  //   - weekly hours: OPT-IN (`opts.withHours`) — one storePolicies.list() for
  //     the whole business, never one get() per store. Off by default because
  //     the app-shell layout re-lists stores on every render and has no use for
  //     hours; only the 設定 doors (web page + screens/settings facade) and
  //     StoresSection's own refresh() ask for them. Deliberately NOT caught
  //     HERE: a policy read that fails must not be reported as "no hours
  //     configured" — that reads as 全店共通の初期値 in the editor and the next
  //     save would overwrite hours the store really has. Three callers, three
  //     postures: settings/page.tsx and screens/settings/route.ts both
  //     `.catch(() => [])` this whole twin (an empty store list, never a false
  //     "no hours"); StoresSection.tsx's refresh() falls back to the plain
  //     listStores() instead, so a rename still repaints while the hours it
  //     already knows stay put (mergeKnownHours).
  const [storesRes, staffByStore, customersByStore, hoursByStore] = await Promise.all([
    synqed.stores.list(),
    synqed.staffStores
      .counts()
      .then((r) => new Map<string, number>(Object.entries(r.counts)))
      .catch(() => new Map<string, number>()),
    synqed.customers
      .countsByStore()
      .then((r) => new Map<string, number>(Object.entries(r.counts)))
      .catch(() => new Map<string, number>()),
    opts.withHours
      ? synqed.storePolicies
          .list()
          .then(
            (r) =>
              new Map(
                r.policies.map((p) => {
                  // Both web and facade rows use the same tolerant READ shape.
                  const parsed = WeeklyHoursSchema.nullable().safeParse(p.weekly_hours ?? null)
                  return [p.store_id, {
                    weeklyHours: parsed.success ? parsed.data : null,
                    weeklyHoursUnreadable: !parsed.success,
                  }] as const
                }),
              ),
          )
      : Promise.resolve(new Map<string, Pick<StoreRow, 'weeklyHours' | 'weeklyHoursUnreadable'>>()),
  ])

  // Lazily create the 本店 primary store so every business ends up with one —
  // EVENTUALLY, not synchronously: a core outage skips this render (failure
  // contract below) and a later zero-store render provisions instead.
  // Only hit on a brand-new business (no stores yet) — its counts are empty
  // anyway, so the parallel fetch above isn't wasted. Re-lists (not a second
  // full twin call) so the count maps from the first pass — both correctly
  // empty for a business that had zero stores — merge with the fresh row.
  let stores = storesRes.stores
  if (opts.ensurePrimary && stores.length === 0) {
    // Outage posture (the chain's failure contract): if core can't answer the
    // name question, SKIP provisioning this render — the store name is a
    // permanent write, and the lazy create retries on every zero-store
    // render, so deferring costs one render and can never bake a wrong name.
    let name: string | null = null
    try {
      name = await businessDisplayName(synqed, businessId, 'Main store')
    } catch {
      /* core unreachable — no permanent write off a failed read */
    }
    if (name !== null) {
      try {
        await synqed.stores.create({ name, is_primary: true })
      } catch {
        /* race: another request created the primary — ignore */
      }
      stores = (await synqed.stores.list()).stores
    }
  }

  return stores.map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address,
    phone: s.phone,
    isPrimary: s.is_primary,
    active: s.active,
    staffCount: staffByStore.get(s.id) ?? 0,
    customerCount: customersByStore.get(s.id) ?? 0,
    businessType: coreBusinessType(s),
    // Only when the caller ASKED. Absent policy row on a withHours read =
    // never configured = null, the same thing the SDK returns as
    // `weekly_hours` on a 'default'-source policy; `undefined` otherwise, so
    // no consumer can mistake "not fetched" for "none configured".
    weeklyHours: opts.withHours ? (hoursByStore.get(s.id)?.weeklyHours ?? null) : undefined,
    weeklyHoursUnreadable: opts.withHours
      ? (hoursByStore.get(s.id)?.weeklyHoursUnreadable ?? false)
      : undefined,
  }))
}

/** Client-threaded core of createStore (facade Bearer path, design-parity
 *  packet 12 §B-3 S2). Carries EVERY rule the write needs so web and facade
 *  can never diverge: zod validation, the owner gate (against the roster/
 *  self-id `deps` supplies — cookie-resolved for web, Bearer-resolved for
 *  the facade), the entitlement cap, and the audit write. `deps.source`
 *  labels the ONE audit row this write ever produces — see the
 *  FACADE_AUDIT_MAP 'skip' rows for stores.create/stores.update
 *  (src/lib/audit.ts): a facade-side audit rule here would double it. */
export async function createStoreCore(
  synqed: StoresClient,
  businessId: string,
  deps: StoreWriteDeps,
  input: StoreInput,
): Promise<{ id: string } | { error: string }> {
  const parsed = storeSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') }
  }
  if (!isRosterOwner(deps.staffList, deps.selfUserId)) {
    return { error: STORE_OWNER_DENIAL }
  }

  // Plan gate (P3): server-side store cap — the authoritative app-level check
  // (the client button is just UX). Dev/owner accounts (Liam) are never capped —
  // is_unlimited / KARUTE_UNLIMITED_BUSINESS_IDS.
  //
  // Soft gate for the payment-later phase: the count read + INSERT below aren't a
  // single transaction, so a rare concurrent double-create by the same owner could
  // slip one store past a finite cap. Accepted for now (store creation is rare +
  // owner-only). Billing-grade atomicity arrives with Stripe seat creation (seats
  // are transactional); a sooner hard floor = a Postgres RPC wrapping count+insert
  // in pg_advisory_xact_lock(hashtext(business_id)).
  const entitlement = await loadEntitlementWithClient(synqed, businessId)
  if (!entitlement.canAddStore) return { error: 'STORE_LIMIT_REACHED' }

  // New stores must declare their vertical (edits stay tolerant — see schema).
  if (!parsed.data.business_type) return { error: 'Business type is required' }

  try {
    // business_type persists in core (stores.business_type — Anthony's column,
    // brief 2026-07-08). Until the column + SDK field land, core's parser strips
    // the key; it starts persisting the moment the column exists. Deliberately
    // NO Karute-side shadow copy — core stays the single source of truth.
    const payload: Parameters<typeof synqed.stores.create>[0] & {
      business_type?: string
    } = {
      name: parsed.data.name,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
      business_type: parsed.data.business_type,
    }
    const store = await synqed.stores.create(payload)
    audit({
      category: 'settings',
      action: 'settings.store_create',
      actorId: deps.selfUserId,
      actorType: 'staff',
      businessId,
      targetType: 'store',
      targetId: store.id,
      requestId: deps.requestId,
      source: deps.source,
    })
    return { id: store.id }
  } catch (e) {
    return { error: `Could not create store: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

/** Client-threaded core of updateStore — see createStoreCore's doc comment
 *  for the shared owner-gate + audit-source contract. No entitlement check
 *  (edits never touch the store count). */
export async function updateStoreCore(
  synqed: StoresClient,
  businessId: string,
  deps: StoreWriteDeps,
  id: string,
  input: StoreInput,
): Promise<{ ok: true } | { error: string }> {
  const parsed = storeSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') }
  }
  if (!isRosterOwner(deps.staffList, deps.selfUserId)) {
    return { error: STORE_OWNER_DENIAL }
  }
  try {
    // Same passthrough as createStoreCore — see the note there.
    const payload: Parameters<typeof synqed.stores.update>[1] & {
      business_type?: string
    } = {
      name: parsed.data.name,
      address: parsed.data.address || null,
      phone: parsed.data.phone || null,
      business_type: parsed.data.business_type,
    }
    await synqed.stores.update(id, payload)
    audit({
      category: 'settings',
      action: 'settings.store_update',
      actorId: deps.selfUserId,
      actorType: 'staff',
      businessId,
      targetType: 'store',
      targetId: id,
      requestId: deps.requestId,
      source: deps.source,
    })
    return { ok: true }
  } catch (e) {
    return { error: `Could not update store: ${e instanceof Error ? e.message : 'unknown'}` }
  }
}

/** setStoreHoursCore's identity bundle. The extra field is the whole point:
 *  core's `acting_staff_id` lives in CORE's STAFF-id space, while
 *  `selfUserId` is the app's PROFILE id (getCurrentUserStaffId / the Bearer
 *  token's auth user). They are different ids for the same human — every
 *  signed-up member of a real roster has `staff.user_id = <profile id>` and a
 *  different `staff.id` — and src/actions/appointments.ts:378-382 already
 *  carries the canonical translation plus the record of this exact bug having
 *  shipped once (`:477-479`).
 *
 *  BOTH doors resolve it BEFORE calling the core, through the SAME
 *  non-creating lookup — the Bearer-safe `lookupSynqedStaffIdForBusiness` —
 *  and hand the answer in here. A settings save must never mint a core staff
 *  record on a miss (R3-1): the web door used to call the creating
 *  `resolveSynqedStaffId`; a caller with no core staff row is now refused
 *  instead, same as the facade always was.
 *  `null` = it would not resolve: unlike the appointments stamp (optional,
 *  best-effort, omitted on failure) this field is REQUIRED by the SDK and core
 *  gates on nothing, so the save is REFUSED. Never a profile id, never a null
 *  fallback. */
type StoreHoursWriteDeps = StoreWriteDeps & { actingStaffId: string | null }

/** One store's week as a single audit line — weekday keys and HH:MM only,
 *  never a name. `default` = no week of its own, i.e. the company-wide hours
 *  apply. Core writes its OWN store_policy.edit row with a full before/after
 *  diff; this is what makes the app's row — the one salon staff actually read
 *  in 監査ログ — carry the same change instead of naming the store and
 *  nothing else. */
function weekForAudit(hours: WeeklyHours | null): string {
  if (hours === null) return 'default'
  return WEEKDAY_KEYS.map((key) => {
    const day = hours[key]
    return `${key}=${day ? `${day.open}-${day.close}` : 'closed'}`
  }).join(' ')
}

/** Client-threaded core of the 営業時間 save — the ONE place a store's own
 *  weekly hours are written, shared by the web `setStoreHours` action and the
 *  facade PATCH /stores/[id]/hours route (same owner-gate + audit-source
 *  contract as createStoreCore/updateStoreCore above).
 *
 *  OWNER-ONLY for release 28, on the SAME hardcoded `isRosterOwner` gate every
 *  other store write uses — no new capability. A manager setting their own
 *  store's hours is the RBAC capability upgrade, a separate lane; it is
 *  recorded, not built here.
 *
 *  THE WAY BACK (⚖ reversible-by-default): an explicit `null` week is the
 *  reset — the SDK's own "clear back to unconfigured" — and rides this same
 *  core, both doors, so the easy direction can never be the destructive one.
 *  It logs as settings.store_hours_reset.
 *
 *  `weekly_hours` is the ONLY policy field sent. Core honours partial update
 *  ("undefined = keep", dist/types.d.ts:1075 — proven against the practice
 *  business 2026-09-16), so re-sending cutoff/cancellation/gap-guard fields
 *  would only risk clobbering settings this editor does not own.
 *
 *  KNOWN LIMITATION, queued: a window that closes AFTER midnight cannot be
 *  expressed (resolveDayHours has no close < open form), so it is refused
 *  with STORE_HOURS_INVALID_WINDOW rather than silently mis-resolved. */
export async function setStoreHoursCore(
  synqed: StoresClient,
  businessId: string,
  deps: StoreHoursWriteDeps,
  storeId: string,
  weeklyHours: unknown,
): Promise<{ ok: true } | { error: string }> {
  // Validation BEFORE the owner check — web parity with createStore/
  // updateStore (#578 audit finding): a non-owner submitting an invalid body
  // sees the validation message the action always returned.
  const parsed = parseStoreWeeklyHours(weeklyHours)
  if ('error' in parsed) return { error: parsed.error }
  if (!isRosterOwner(deps.staffList, deps.selfUserId)) {
    return { error: STORE_OWNER_DENIAL }
  }
  // A receipt-grade governance row must never carry a store id this business
  // does not own — the same guard its locked settings sibling carries
  // (recording-autostart.ts). No store-lock call: this door is owner-only
  // (isRosterOwner above), and an owner can never be clamped to a subset of
  // their own stores.
  if (typeof storeId !== 'string' || storeId.length === 0) {
    return { error: STORE_HOURS_UNKNOWN_STORE }
  }
  try {
    const { stores } = await synqed.stores.list()
    if (!stores.some((s) => s.id === storeId)) return { error: STORE_HOURS_UNKNOWN_STORE }
  } catch (e) {
    // A failed READ of the list is not proof the store is unknown — a real
    // owner would be told 「unknown store」 for what was only core blipping.
    // Same shape as the core-failure catch below (StoreHoursBlock toasts an
    // unrecognized error code RAW), never the unknown-store refusal.
    return {
      error: `Could not update store hours: ${e instanceof Error ? e.message : 'unknown'}`,
    }
  }
  // CORE's staff-id space, resolved by the door (see StoreHoursWriteDeps).
  // Unresolvable = REFUSE — never deps.selfUserId, which is a profile id.
  const actingStaffId = deps.actingStaffId
  if (!actingStaffId) return { error: STORE_HOURS_ACTOR_UNRESOLVED }
  try {
    // A failed read or a policy this app cannot read must block save AND reset,
    // including requests from older shells that ignore the DTO's flag.
    const policy = await synqed.storePolicies.get(storeId)
    const currentHours = WeeklyHoursSchema.nullable().safeParse(policy?.weekly_hours ?? null)
    if (!currentHours.success) return { error: STORE_HOURS_UNREADABLE }
    const before = weekForAudit(currentHours.data)
    await synqed.storePolicies.set(storeId, {
      weekly_hours: parsed.hours,
      acting_staff_id: actingStaffId,
    })
    // ONE row from the app's own emitter, exactly how settings.store_update is
    // emitted by updateStoreCore — and the SDK's optional `audit` input stays
    // unused, because passing it would add a THIRD row.
    //
    // MEASURED 2026-09-16, not assumed: core audits storePolicies.set BY
    // ITSELF, unconditionally — a store_policy.edit row with its own
    // before/after diff, written whether or not the SDK `audit` input is
    // passed. So every save leaves two rows: core's, in core's log, and this
    // one, in the app's log that salon staff read. Keeping ours is the
    // ruling; carrying the same change in `detail` is what stops it being
    // the poorer twin.
    const row = {
      category: 'settings',
      actorId: deps.selfUserId,
      actorType: 'staff',
      businessId,
      targetType: 'store',
      targetId: storeId,
      source: deps.source,
      detail: { before, after: weekForAudit(parsed.hours) },
    } as const
    // The way back is its own act in the log — 「この店舗の時間を消して全店共通
    // に戻した」 is not the same fact as 「時間を変えた」, and a reader scanning
    // actions should not have to open the diff to tell them apart. Two literal
    // emits over one shared row: CP4 bans a computed `action` argument and CP5
    // wants `requestId` visible at each call site.
    const requestId = deps.requestId
    if (parsed.hours === null) {
      audit({ ...row, action: 'settings.store_hours_reset', requestId })
      return { ok: true }
    }
    audit({ ...row, action: 'settings.store_hours_update', requestId })
    return { ok: true }
  } catch (e) {
    return {
      error: `Could not update store hours: ${e instanceof Error ? e.message : 'unknown'}`,
    }
  }
}

/** Client-threaded core of getStaffStores (facade Bearer path, design-parity
 *  packet 12 §S4a). Graceful pre-migration (no profile_stores table → []) —
 *  same tolerance as the web wrapper below. */
export async function getStaffStoresWithClient(
  synqed: StoresClient,
  staffId: string,
): Promise<string[]> {
  try {
    return (await synqed.staffStores.get(staffId)).store_ids
  } catch {
    return []
  }
}

/** Client-threaded core of setStaffStores (facade Bearer path, design-parity
 *  packet 12 §S4a — same owner gate + audit-source contract as
 *  createStoreCore/updateStoreCore; STRICTER than staff.manage per the
 *  original requireOwnerBusiness gate, kept as-is here). */
export async function setStaffStoresCore(
  synqed: StoresClient,
  businessId: string,
  deps: StoreWriteDeps,
  staffId: string,
  storeIds: string[],
): Promise<{ ok: true } | { error: string }> {
  if (!isRosterOwner(deps.staffList, deps.selfUserId)) {
    return { error: STORE_OWNER_DENIAL }
  }
  // staff_stores lives in core now; the reconcile (validate + atomic upsert/
  // delete) happens server-side in one transaction.
  try {
    await synqed.staffStores.set(staffId, storeIds)
    // Store assignment changes what data a staff member can reach — notice,
    // like permissions_change. count 0 = the "works in every store" state.
    audit({
      category: 'settings',
      action: 'settings.staff_stores_change',
      severity: 'notice',
      actorId: deps.selfUserId,
      actorType: 'staff',
      businessId,
      targetType: 'staff',
      targetId: staffId,
      detail: { store_ids: storeIds.join(','), count: storeIds.length },
      requestId: deps.requestId,
      source: deps.source,
    })
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not update stores' }
  }
}
