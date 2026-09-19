'use server'

import { cache } from 'react'
import { revalidatePath, updateTag } from 'next/cache'
import { cookies } from 'next/headers'
import type { SynqedClient, WeeklyHours } from '@synqed-kk/client'

import { getSynqedClient } from '@/lib/synqed/client'
import { businessDisplayName } from '@/lib/business-name'
import { WEEKDAY_KEYS } from '@/lib/operating-hours'
import { getBusinessId, getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import {
  storeSchema,
  type StoreInput,
  STORE_OWNER_DENIAL,
  STORE_HOURS_ACTOR_UNRESOLVED,
  parseStoreWeeklyHours,
} from '@/lib/validations/store'
import { loadEntitlementWithClient } from '@/lib/entitlements'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { audit } from '@/lib/audit'
// The tolerant business_type reader lives beside the registry: this is a
// 'use server' module, where every export is a callable endpoint, so it cannot
// be declared here — and the 予約 capacity path needs the same one answer.
import { coreBusinessType } from '@/lib/welcome/business-types'
import { actorIsUnassigned, STORE_UNASSIGNED_DENIAL } from '@/lib/auth/store-gate'

// Explicit-client seam (design-parity packet 12 §B-3 S2 — the P-B pattern):
// every twin below takes this instead of resolving getSynqedClient() from the
// cookie session, so the facade (Bearer path, business resolved from the
// verified token) and the web actions run the IDENTICAL write/read logic.
type StoresClient = Pick<
  SynqedClient,
  'stores' | 'staffStores' | 'customers' | 'entitlements' | 'orgSettings' | 'storePolicies'
>

/** Roster row shape the owner gate needs — a subset of StaffMember so the
 *  twin doesn't import the whole staff module's type surface. */
type RosterRow = { id: string; display_role?: string | null }

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
type StoreWriteDeps = {
  staffList: RosterRow[]
  selfUserId: string | null
  source: 'web' | 'facade'
  /** PR-M5 piece ④: minted at the web action boundary / read off ctx.meta on
   *  the facade twin. */
  requestId?: string
}

// Active-store view filter — which location the viewer is looking at. A cookie,
// not a security boundary (RLS/business scope is the boundary); the owner switch
// is a view preference. Reading it back filters store-scoped surfaces.
const ACTIVE_STORE_COOKIE = 'karute_active_store'

// ───────────────────────────────────────────────────────────────────────────
// Stores (locations) CRUD. Service-role-only table (src/.../20260604000000) —
// every read/write goes through here with an explicit business_id scope, so one
// business can't touch another's stores.
//
// Mutations are OWNER-only (display_role === 'owner', mirroring settings/page.tsx).
// When the RBAC stack (#159/#162) lands this upgrades to
// requireCapability('settings.manage') so managers/SVs can manage stores too.
//
// store_id is the LOCATION layer; business_id stays the tenant + coaching scope.
// Staff/customer counts are wired to real data in later phases (profiles.store_id
// = P2; customers/karute store_id = synqed-core, Anthony).
// ───────────────────────────────────────────────────────────────────────────

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
  //     hours; only the 設定 doors (web page + screens/settings facade), whose
  //     店舗 tab renders the editor, ask for them. Deliberately NOT caught: a
  //     policy read that fails must not be reported as "no hours configured" —
  //     that reads as 全店共通の初期値 in the editor and the next save would
  //     overwrite hours the store really has. It rides the same failure
  //     contract as stores.list() itself (both settings doors already
  //     `.catch(() => [])` this whole twin).
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
              new Map<string, WeeklyHours | null>(
                r.policies.map((p) => [p.store_id, p.weekly_hours]),
              ),
          )
      : Promise.resolve(new Map<string, WeeklyHours | null>()),
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
    weeklyHours: opts.withHours ? (hoursByStore.get(s.id) ?? null) : undefined,
  }))
}

/** Cookie-session context resolution shared by the two web readers below —
 *  the lazy 本店-create prelude itself lives in the twin (shared with the
 *  facade paths). */
async function listStoresForWeb(withHours: boolean): Promise<StoreRow[]> {
  let businessId: string
  try {
    businessId = await getBusinessId()
  } catch {
    return []
  }
  const synqed = await getSynqedClient()
  return listStoresWithClient(synqed, businessId, { ensurePrimary: true, withHours })
}

/** All stores for the caller's business (anyone in the business can read).
 *  NO hours — this is the app-shell layout's per-render read and StoresSection's
 *  own refresh(); neither renders 営業時間. */
export async function listStores(): Promise<StoreRow[]> {
  return listStoresForWeb(false)
}

/** listStores + each store's own weekly hours (ONE storePolicies.list()). The
 *  設定 page's read: its 店舗 tab is the only web surface that edits them. */
export async function listStoresWithHours(): Promise<StoreRow[]> {
  return listStoresForWeb(true)
}

/** The viewer's active store (a cookie). Null when unset → "all / primary". */
export async function getActiveStoreId(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(ACTIVE_STORE_COOKIE)?.value ?? null
}

// Per-request dedupe (React cache): layout + page + actions each resolve the
// store scope, and a viewer with no pinned cookie (every single-store salon —
// the switcher never renders for them) would otherwise pay one stores.list
// core roundtrip per call site on every request.
const primaryStoreIdOnce = cache(async (): Promise<string | null> => {
  try {
    const synqed = await getSynqedClient()
    const { stores } = await synqed.stores.list()
    return stores.find((s) => s.is_primary)?.id ?? stores[0]?.id ?? null
  } catch {
    return null
  }
})

/** The business's primary store id (?? first store). Null when the business
 *  has no stores yet or the lookup fails. */
export async function getPrimaryStoreId(): Promise<string | null> {
  return primaryStoreIdOnce()
}

/** The store that store-scoped reads/writes default to: the pinned cookie,
 *  else the PRIMARY store. The StoreSwitcher displays the primary as active
 *  when nothing is pinned ("there is always an active store") — data and
 *  display must share that default, otherwise an unpinned cross-store viewer
 *  sees a pill naming one store over a list mixing every store (the カルテ
 *  leak Liam kept hitting). */
export async function getDefaultStoreId(): Promise<string | null> {
  return (await getActiveStoreId()) ?? getPrimaryStoreId()
}

/** Switch the active store. Validates the store is in the caller's business
 *  (so the cookie can never point at another tenant's store), then persists it. */
export async function setActiveStore(storeId: string): Promise<{ ok: true } | { error: string }> {
  // getSynqedClient resolves the business from the session, so it doubles as the
  // auth check. Validate the store belongs to the caller's business via core
  // (the client is business-scoped, so a 404 means it's not this tenant's store).
  let synqed
  try {
    synqed = await getSynqedClient()
  } catch {
    return { error: 'Not authenticated' }
  }
  try {
    await synqed.stores.get(storeId)
  } catch {
    return { error: 'Store not found.' }
  }

  // RBAC clamp: a branch-restricted staff (no stores.viewAll) may only pin a
  // store they're assigned to — otherwise the cookie would be a back door around
  // the store-scoped reads (lib/auth/store-scope). Cross-store roles and floating
  // staff (empty staff_stores = works everywhere) are unaffected.
  const caps = await getMyCapabilities()
  if (!caps.has('stores.viewAll')) {
    const uid = await getCurrentUserStaffId()
    const allowed = uid ? await getStaffStoresStrict(uid) : null
    if (allowed && allowed.length > 0 && !allowed.includes(storeId)) {
      return { error: 'You can only view a store you are assigned to.' }
    }
    // ⚖ Liam 2026-09-16, the third flip point: an UNASSIGNED actor may pin no
    // store at all. `getStaffStores` swallowed a failed lookup to `[]`, which
    // read as "floating, pin anything" — the strict twin keeps the failure
    // apart (null above) so only a GENUINE empty assignment reaches the gate,
    // which is then answered by the gate's ONE resolution, memoized alongside
    // the capability seam's.
    if (allowed && allowed.length === 0 && uid && (await actorIsUnassigned(uid))) {
      return { error: STORE_UNASSIGNED_DENIAL }
    }
  }

  const jar = await cookies()
  jar.set(ACTIVE_STORE_COOKIE, storeId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Clear the active store → the 全店舗 (all-stores) cross-store view. Same
 *  validation-free safety as reading: an absent cookie just means "all stores". */
export async function clearActiveStore(): Promise<{ ok: true }> {
  const jar = await cookies()
  jar.delete(ACTIVE_STORE_COOKIE)
  revalidatePath('/', 'layout')
  return { ok: true }
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

export async function createStore(
  input: StoreInput,
): Promise<{ id: string } | { error: string }> {
  // No pre-gate: resolve context tolerantly and let the core decide
  // everything (validation, THEN the owner check — web parity, #578 audit
  // finding). A requireOwnerBusiness() pre-gate here would short-circuit
  // before the core's zod parse, so a non-owner submitting an invalid body
  // would see the ownership denial instead of the validation message the
  // action always returned.
  let businessId: string
  let staffList: RosterRow[]
  let selfUserId: string | null
  let synqed: StoresClient
  try {
    businessId = await getBusinessId()
    ;[staffList, selfUserId] = await Promise.all([getStaffList(), getCurrentUserStaffId()])
    synqed = await getSynqedClient()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  const result = await createStoreCore(
    synqed,
    businessId,
    { staffList, selfUserId, source: 'web', requestId: crypto.randomUUID() },
    input,
  )
  if ('id' in result) revalidatePath('/settings')
  return result
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

export async function updateStore(
  id: string,
  input: StoreInput,
): Promise<{ ok: true } | { error: string }> {
  // No pre-gate — same reasoning as createStore above: the core decides
  // validation before ownership, so a non-owner's invalid body still gets
  // the validation message.
  let businessId: string
  let staffList: RosterRow[]
  let selfUserId: string | null
  let synqed: StoresClient
  try {
    businessId = await getBusinessId()
    ;[staffList, selfUserId] = await Promise.all([getStaffList(), getCurrentUserStaffId()])
    synqed = await getSynqedClient()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  const result = await updateStoreCore(
    synqed,
    businessId,
    { staffList, selfUserId, source: 'web', requestId: crypto.randomUUID() },
    id,
    input,
  )
  if ('ok' in result) revalidatePath('/settings')
  return result
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
  // CORE's staff-id space, resolved by the door (see StoreHoursWriteDeps).
  // Unresolvable = REFUSE — never deps.selfUserId, which is a profile id.
  const actingStaffId = deps.actingStaffId
  if (!actingStaffId) return { error: STORE_HOURS_ACTOR_UNRESOLVED }
  try {
    // The week this store had before the save, for the app audit row's own
    // diff. Never blocks the save: an unreadable policy row costs the BEFORE
    // half of one log line, nothing else.
    const before = await synqed.storePolicies
      .get(storeId)
      .then((policy) => weekForAudit(policy.weekly_hours ?? null))
      .catch(() => 'unavailable')
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

/** Save one store's weekly 営業時間 (web door). Owner-only, seven weekdays
 *  always — see setStoreHoursCore. */
export async function setStoreHours(
  storeId: string,
  weeklyHours: unknown,
): Promise<{ ok: true } | { error: string }> {
  // No pre-gate — same reasoning as createStore/updateStore above.
  let businessId: string
  let staffList: RosterRow[]
  let selfUserId: string | null
  let synqed: StoresClient
  try {
    businessId = await getBusinessId()
    ;[staffList, selfUserId] = await Promise.all([getStaffList(), getCurrentUserStaffId()])
    synqed = await getSynqedClient()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  // The canonical profile-id → CORE staff-id translation — the SAME
  // non-creating lookup the facade uses (R3-1: a settings save must never
  // mint a core staff record on a miss; only the booking flow's
  // resolveSynqedStaffId is allowed to create). `null` refuses the save
  // inside the core rather than stamping core's `updated_by` with a profile
  // id (see StoreHoursWriteDeps).
  // Deferred (the house idiom in this dir): staff-map pulls the SDK, and
  // listStores() — the app-shell layout's per-render read — has no business
  // dragging that in for a write path only this action reaches.
  let actingStaffId: string | null = null
  if (selfUserId) {
    const { lookupSynqedStaffIdForBusiness } = await import('@/lib/synqed/staff-map')
    actingStaffId = await lookupSynqedStaffIdForBusiness(selfUserId, businessId).catch(() => null)
  }
  const result = await setStoreHoursCore(
    synqed,
    businessId,
    { staffList, selfUserId, actingStaffId, source: 'web', requestId: crypto.randomUUID() },
    storeId,
    weeklyHours,
  )
  // Same revalidation updateStore does — and the same NOTHING else: no cache
  // tag exists for these numbers (both readers call storePolicies.get uncached).
  if ('ok' in result) revalidatePath('/settings')
  return result
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

/** The stores a staff member belongs to (empty = works in every store). Graceful
 *  pre-migration (no profile_stores table → []). */
export async function getStaffStores(staffId: string): Promise<string[]> {
  try {
    const synqed = await getSynqedClient()
    return getStaffStoresWithClient(synqed, staffId)
  } catch {
    return []
  }
}

/** Strict twin of getStaffStores for resolveStoreScope's fail-closed write
 *  clamp (⚖ Liam 2026-08-17, menu-catalog fix round F-A): null signals the
 *  assignment LOOKUP ITSELF failed — distinct from a genuine empty assignment
 *  ([]), which the floating-staff convention already treats as "works
 *  everywhere". getStaffStores (and every existing caller of it) keeps
 *  swallowing failures to [] exactly as before; only resolveStoreScope needs
 *  the distinction, to refuse writes it can't actually vouch for. */
export async function getStaffStoresStrict(staffId: string): Promise<string[] | null> {
  try {
    const synqed = await getSynqedClient()
    return (await synqed.staffStores.get(staffId)).store_ids
  } catch {
    return null
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

/** Set the stores a staff member belongs to (empty array = works in every store).
 *  Owner-only; validates the staff and every store are in the caller's business,
 *  then REPLACES the full assignment set. business-scoped at every step so a link
 *  can never reference another tenant's staff or store. */
export async function setStaffStores(
  staffId: string,
  storeIds: string[],
): Promise<{ ok: true } | { error: string }> {
  let businessId: string
  let staffList: RosterRow[]
  let selfUserId: string | null
  let synqed: StoresClient
  try {
    businessId = await getBusinessId()
    ;[staffList, selfUserId] = await Promise.all([getStaffList(), getCurrentUserStaffId()])
    synqed = await getSynqedClient()
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allowed' }
  }
  const result = await setStaffStoresCore(
    synqed,
    businessId,
    { staffList, selfUserId, source: 'web', requestId: crypto.randomUUID() },
    staffId,
    storeIds,
  )
  if ('ok' in result) {
    // updateTag is Server-Action-only (throws from a Route Handler) — stays
    // here, not in the core the facade route also calls.
    updateTag('staff-list')
    revalidatePath('/settings')
  }
  return result
}
