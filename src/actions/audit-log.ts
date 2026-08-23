'use server'

// 監査ログ viewer read path (AUDIT-LOG-DESIGN.md §11, fix-plan P1-D).
// Owner-only by default; a manager reaches it only via the explicit audit.view
// grant — enforced HERE (the tab filter is exposure reduction, not security).
import { newSynqedClient } from '@/lib/synqed/client'
import { getMyCapabilities, ensureCapability } from '@/lib/auth/require-permission'
import { audit } from '@/lib/audit'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'

/** Mirror of core's audit row (SDK 1.13 ListAuditResponse.events[]). Local
 *  mirror instead of the SDK type so this file types against the pinned local
 *  SDK too — CI compiles against 1.13 either way. */
export interface AuditLogEvent {
  id: string
  at: string
  actor_id: string | null
  actor_type: string
  category: string
  action: string
  target_type: string | null
  target_id: string | null
  target_label: string | null
  detail: unknown
  break_glass: boolean
  severity: string
  /** Write-time snapshot name (SDK 1.14, synqed-core PR #52) — durable even
   *  after the staff row is renamed/removed. Absent on old cached responses;
   *  optional here so those keep parsing. Component prefers this over the
   *  live roster lookup. */
  actor_label?: string | null
  /** R7-1 (Liam's phone review, 8/23: "extremely important"): read-time-only
   *  display line for karute.customer_reassign rows — "<from-name> →
   *  <to-name>", built ONCE here (not a core field, unlike actor_label
   *  above) from the SAME extended resolveTargetLabels() map both the web
   *  page and the facade DTO already carry. Set ONLY for reassign rows with
   *  both ids present as strings — every other row leaves this undefined,
   *  so it's additive and harmless everywhere else. Deleted/unknown
   *  customer ids fall back to the raw id (resolveTargetLabels' existing
   *  fallback), never a crash or a blank arrow. */
  reassign_customer_line?: string
}

export interface AuditLogFilters {
  category?: string
  /** Cause-based person filter (design §10 — raw events only, never stats). */
  actorId?: string
  /** ISO datetimes (core validates z.string().datetime()). */
  from?: string
  to?: string
  /** Per-customer dispute view (the ?target= deep-link). */
  targetId?: string
  /** Default feed hides view events (they outnumber changes ~10:1). */
  includeViews?: boolean
  breakGlass?: boolean
  page?: number
}

const PAGE_SIZE = 100

/** View-kind actions (customer.view, privacy.audit_log.view, …) stay out of
 *  the default feed by naming convention. Core's exclude_views excludes BOTH
 *  suffixes server-side — '.view' since SDK 1.14, '_view' since the 7/27
 *  widen (synqed-core #56, MERGED + auto-deployed; CI-proven with a posted
 *  '_view' row asserted excluded and totals exact). Historical
 *  privacy.audit_log_view rows are therefore excluded from the feed AND its
 *  total/hasMore counts by the server. This belt is pure defense-in-depth
 *  (e.g. a core rollback), not a correctness dependency. */
function isViewAction(action: string): boolean {
  return action.endsWith('.view') || action.endsWith('_view')
}

type ListAuditLogResult =
  | {
      ok: true
      events: AuditLogEvent[]
      total: number
      page: number
      hasMore: boolean
      /** Exact 緊急アクセス count for the summary strip (same window,
       *  break_glass=true). Null when unknown: the count query degraded, or
       *  a person filter is active (I7 — the strip never renders per-staff
       *  counts, so no aux query is spent). */
      breakGlassTotal: number | null
      /** Exact 変更/警告 strip counts (SDK 1.14 severity/exclude_views params —
       *  packet 18 T1). Both null together on ANY probe failure (never a
       *  partial sum) or when the probes are skipped (I7 actorId scope, or
       *  breakGlass — the strip's own feed IS the count then). Component
       *  falls back to its client-side approximate count + '+' when null. */
      warningsTotal: number | null
      changesTotal: number | null
      /** Display names for this page's customer/store/staff targets — rows
       *  store ids only (PII rule), so names join at read time. Staff also
       *  resolve client-side off the roster; this map is the fallback for ids
       *  the roster can't key (historical id-space rows, departed staff). */
      targetLabels: Record<string, string>
    }
  | { ok: false; error: 'forbidden' | 'failed' }

/** Client-threaded core of listAuditLog (facade Bearer path, design-parity
 *  packet 17 §S3 — the 監査ログ tab going live). Carries the post-gate read
 *  AND the privacy.audit_log.view write so web and facade can never diverge;
 *  `actor` is the ONLY thing that differs between callers (cookie-resolved
 *  staff/business for web, Bearer-resolved for the facade) — always resolved
 *  by the caller now (contract §3.1, PR-M1): a client-supplied flag can no
 *  longer decide whether a read gets disclosed, so every invocation of this
 *  read — page 1, paging, filtered — writes its own row on success. */
export async function listAuditLogWithClient(
  synqed: ReturnType<typeof newSynqedClient>,
  actor: {
    staffId: string | null
    businessId: string | null
    source: 'web' | 'facade'
    /** PR-M5 piece ④: minted at the web action boundary / read off
     *  ctx.meta on the facade twin. */
    requestId?: string
  },
  filters: AuditLogFilters,
): Promise<ListAuditLogResult> {
  try {
    const page = Math.max(1, Math.trunc(filters.page ?? 1))
    const baseQuery = {
      category: filters.category || undefined,
      actor_id: filters.actorId || undefined,
      target_type: filters.targetId ? ('customer' as const) : undefined,
      target_id: filters.targetId || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }
    // Local SDK (1.11.1) has no `audit` property yet — `synqed.audit.list`
    // below already errors at tsc baseline (11, unchanged by CI's real
    // ^1.15.0). Wrapping the call ONCE keeps that a single error site
    // instead of one per probe call (ponytail: `as any` scoped to this one
    // line, not sprinkled per call — upgrade path is deleting this cast once
    // the SDK bump lands). MUST stay a call THROUGH `synqed.audit` — a bare
    // method extraction loses the receiver, and AuditClient.list reads
    // `this.client`, so every probe rejects and the catch nulls the pair
    // (probes silently dead in prod; found by the post-#581 live wire check).
    const auditListProbe = (q: Record<string, unknown>): Promise<{ total: number }> =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same stale-SDK gap as above, scoped to one line
      (synqed as any).audit.list(q)
    // T1 strip-count probes (page_size 1, total only) — skipped under the
    // SAME condition as the break-glass probe below (I7 actorId scope) plus
    // breakGlass on (that feed IS the count strip then).
    const skipStripProbes = Boolean(filters.breakGlass) || Boolean(filters.actorId)

    const [res, breakGlassRes, warnAllRes, critAllRes, nvWarnRes, nvCritRes, nvAllRes] =
      await Promise.all([
        synqed.audit.list({
          ...baseQuery,
          exclude_views: filters.includeViews ? undefined : true,
          break_glass: filters.breakGlass ? true : undefined,
          page,
          page_size: PAGE_SIZE,
        }),
        // Strip count — page_size 1, only the total matters. Skipped when the
        // break-glass filter is already on (the main total IS the count) and
        // when a person filter is active (the strip hides — I7). Best-effort:
        // a failed count must never take the feed down with it.
        filters.breakGlass || filters.actorId
          ? null
          : synqed.audit
              .list({ ...baseQuery, break_glass: true, page: 1, page_size: 1 })
              .catch(() => null),
        skipStripProbes
          ? null
          : auditListProbe({ ...baseQuery, severity: 'warn', page: 1, page_size: 1 }).catch(
              () => null,
            ),
        skipStripProbes
          ? null
          : auditListProbe({ ...baseQuery, severity: 'critical', page: 1, page_size: 1 }).catch(
              () => null,
            ),
        skipStripProbes
          ? null
          : auditListProbe({
              ...baseQuery,
              exclude_views: true,
              severity: 'warn',
              page: 1,
              page_size: 1,
            }).catch(() => null),
        skipStripProbes
          ? null
          : auditListProbe({
              ...baseQuery,
              exclude_views: true,
              severity: 'critical',
              page: 1,
              page_size: 1,
            }).catch(() => null),
        // 変更 probe (Wave V — the restore the #630 comment queued): all
        // non-view rows regardless of severity; exact 変更 = this minus the
        // two nv severity probes below it. Same skip + best-effort contract
        // as every other strip probe.
        skipStripProbes
          ? null
          : auditListProbe({ ...baseQuery, exclude_views: true, page: 1, page_size: 1 }).catch(
              () => null,
            ),
      ])

    // Reading the 監査ログ is itself a privileged read — ONE row per
    // invocation of this read (contract §3.1, PR-M1): page 1, paging, and
    // filter clicks each write their own row now — no client-supplied flag
    // gates it. The '.view' suffix (respelled from '_view', Liam 7/27 —
    // §3.1 key amendment) puts it inside core's server-side exclude_views
    // match, so the default feed's total/hasMore stay exact — no drift from
    // this row's own volume. Historical '_view'-spelled rows stay hidden by
    // the client belt below.
    audit({
      category: 'privacy',
      action: 'privacy.audit_log.view',
      actorId: actor.staffId,
      actorType: 'staff',
      businessId: actor.businessId,
      ...(filters.targetId
        ? { targetType: 'customer' as const, targetId: filters.targetId }
        : {}),
      requestId: actor.requestId,
      source: actor.source,
    })

    // BELT on top of server exclude_views (packet-18 fix round): the server
    // now excludes BOTH view spellings — '.view' (SDK 1.14) and '_view'
    // (synqed-core #56, merged + deployed 7/27, CI-proven) — so res.total and
    // hasMore are exact and no view row of either era reaches this filter in
    // the default feed. The belt stays as pure defense-in-depth against a
    // core-side regression, mirroring isViewAction's doc above.
    const events = (res.events as AuditLogEvent[]).filter(
      (e) => filters.includeViews || !isViewAction(e.action),
    )
    // 警告 is exact in BOTH view states: views hidden → count only non-'.view'
    // warn/crit (nvWarn/nvCrit, matching what the feed shows); views shown →
    // count all warn/crit (warnAll/critAll). Pair must be complete — never a
    // partial sum from a failed probe (T1). Exactness in the hidden state
    // additionally rests on no '_view'-suffix action ever carrying warn/crit
    // severity (the only rows ever written with that spelling — historical
    // privacy.audit_log_view — are always info) — if the audit taxonomy ever
    // grows one, it shares the same core-side exclude_views dependency the
    // 変更 subtraction below leans on (both exact only while the server's
    // view-suffix exclusion — the #56 widen — matches isViewAction).
    const warnPair = filters.includeViews ? [warnAllRes, critAllRes] : [nvWarnRes, nvCritRes]
    const warnPairOk = warnPair.every((r) => r !== null)
    const targetLabels = await resolveTargetLabels(synqed, events)
    // R7-1: build the reassign display line ONCE here, off the SAME
    // (now-extended) targetLabels map — shared by the web action AND the
    // facade route (both call this twin), so neither needs its own copy of
    // this template. Set only for karute.customer_reassign rows with both
    // ids present; every other row leaves the field undefined.
    for (const e of events) {
      if (e.action !== 'karute.customer_reassign') continue
      const d = e.detail as { from_customer_id?: unknown; to_customer_id?: unknown } | null
      const fromId = d?.from_customer_id
      const toId = d?.to_customer_id
      if (typeof fromId !== 'string' || typeof toId !== 'string') continue
      e.reassign_customer_line = `${targetLabels[fromId] ?? fromId} → ${targetLabels[toId] ?? toId}`
    }
    return {
      ok: true,
      events,
      total: res.total,
      page: res.page,
      // hasMore follows the server-filtered total, which is exact since the
      // #56 widen (server excludes both view spellings from events AND
      // total) — the belt hides nothing the server counted.
      hasMore: res.page * res.page_size < res.total,
      breakGlassTotal: breakGlassRes
        ? breakGlassRes.total
        : filters.breakGlass
          ? res.total
          : null,
      warningsTotal: warnPairOk ? warnPair[0]!.total + warnPair[1]!.total : null,
      // 変更 is exact (Wave V restore; the #56 widen made nvAll view-clean):
      // nvAll − nvWarn − nvCrit, i.e. non-view rows that aren't warn/crit —
      // matching the component's client lens exactly, in BOTH view-toggle
      // states (views are never 変更). Triple must be complete — a partial
      // subtraction would understate silently; any failed probe → null and
      // the component keeps its honest client approx + '+'. Clamped at 0:
      // the three probes are independent reads, and a row written between
      // them could otherwise push the difference negative.
      changesTotal:
        nvAllRes !== null && nvWarnRes !== null && nvCritRes !== null
          ? Math.max(0, nvAllRes.total - nvWarnRes.total - nvCritRes.total)
          : null,
      targetLabels,
    }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

/** Thin wrapper — always resolves the cookie session into `actor` (contract
 *  §3.1, PR-M1: every invocation writes its own row, so every invocation
 *  needs the actor), then delegates to the twin. businessId is resolved ONCE
 *  and feeds BOTH the client construction and the audit row (blind-round
 *  security find, ledger #8): two independent resolves could diverge under a
 *  future de-memoization of getBusinessId, and a divergence would silently
 *  skip the durable row (audit() drops core forwarding when businessId is
 *  null) — single-sourcing makes that structurally impossible, matching how
 *  the facade route builds both from one ctx.identity.businessId. */
export async function listAuditLog(filters: AuditLogFilters): Promise<ListAuditLogResult> {
  try {
    ensureCapability(await getMyCapabilities(), 'audit.view')
  } catch {
    return { ok: false, error: 'forbidden' }
  }
  // A failed session/business resolve or client construction must keep
  // returning the 'failed' envelope, never throw across the server-action
  // boundary (and never proceed to an unattributable read).
  let businessId: string
  let synqed: ReturnType<typeof newSynqedClient>
  try {
    businessId = await getBusinessId()
    synqed = newSynqedClient(businessId)
  } catch {
    return { ok: false, error: 'failed' }
  }
  const actor = {
    staffId: await getCurrentUserStaffId().catch(() => null),
    businessId,
    source: 'web' as const,
    // PR-M5 piece ④: minted once at the action boundary — the one id every
    // audit row of this invocation carries.
    requestId: crypto.randomUUID(),
  }
  return listAuditLogWithClient(synqed, actor, filters)
}

// Core casts every id in customers.list's `ids` batch to UUID — ONE
// malformed id (the phone memory-route sentinel '-', root-cause fix
// 2026-08-29) 500s the WHOLE findMany and silently drops every label on the
// page (the batch call's catch below then leaves ALL ids raw, not just the
// poisoned one). Mirrored in handler.ts's logFacadeAudit (can't import —
// that file is 'use server', which only permits async function exports).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Batch name lookup for this page's customer + store targets. Best-effort:
 *  a failed lookup degrades to ids in the UI, never fails the feed. Deleted
 *  customers resolve while soft-deleted (include_deleted); hard-purged rows
 *  simply don't — the row's id stands, which is the honest state. */
async function resolveTargetLabels(
  synqed: ReturnType<typeof newSynqedClient>,
  events: AuditLogEvent[],
): Promise<Record<string, string>> {
  const idsOf = (type: string) =>
    [...new Set(events.filter((e) => e.target_type === type && e.target_id).map((e) => e.target_id!))]
  const labels: Record<string, string> = {}
  const customerIds = idsOf('customer')
  // karute rows resolve their CUSTOMER's label, not a karute-record name — the
  // customer id rides in detail (packet 30 §4, ids-only PII rule), batched
  // into the SAME customers.list call and keyed by the karute row's own
  // target_id so the existing targetLabels[e.target_id] lookup below (and in
  // AuditLogSection) needs no change.
  const karuteCustomerIds = events
    .filter((e) => e.target_type === 'karute')
    .map((e) => (e.detail as { customer_id?: unknown } | null)?.customer_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  // 2026-07-29 field find (ぴあそん りえむ raw-UUID row): historical karute-target
  // rows written before customer_id rode in detail can only resolve through the
  // record itself — so ids still unresolved after the detail pass get a bounded,
  // best-effort karute.get each (no ids-filter exists on karute.list — same SDK
  // gap as pack-undo; a core ids filter would collapse this to one call). Cap
  // keeps the worst page (50 distinct cold karutes) from fanning out unbounded;
  // a capped-out or failed/deleted id stays raw, the honest state.
  const detailKaruteIds = new Set(
    events
      .filter(
        (e) =>
          e.target_type === 'karute' &&
          typeof (e.detail as { customer_id?: unknown } | null)?.customer_id === 'string',
      )
      .map((e) => e.target_id!),
  )
  const unresolvedKaruteIds = idsOf('karute')
    .filter((id) => !detailKaruteIds.has(id))
    .slice(0, 30)
  const karuteCustomerById = new Map<string, string>()
  if (unresolvedKaruteIds.length > 0) {
    // async wrapper (not a bare .then chain): a SYNCHRONOUS throw — e.g. a
    // client without the karuteRecords surface — must degrade to raw ids for
    // those rows, never crash the whole feed.
    await Promise.all(
      unresolvedKaruteIds.map(async (id) => {
        try {
          // include_entries:false — this lookup exists ONLY to read
          // customer_id; without it core defaults to shipping the full
          // clinical entry set (blind-round P2, least-privilege).
          const r = await synqed.karuteRecords.get(id, { include_entries: false })
          const cid = (r as { customer_id?: unknown }).customer_id
          if (typeof cid === 'string' && cid.length > 0) karuteCustomerById.set(id, cid)
        } catch {
          /* id stays raw */
        }
      }),
    )
  }
  // R7-1 (Liam's phone review, 8/23): the reassign row's OWN two customer
  // ids (from_customer_id/to_customer_id) — widening this SAME batch, never
  // a second resolver. Keyed by the customer id itself (not the row's
  // target_id, which is the KARUTE id) — same idiom as menu_update's
  // store_id_old/store_id_new below.
  const reassignCustomerIds = events
    .filter((e) => e.action === 'karute.customer_reassign')
    .flatMap((e) => {
      const d = e.detail as { from_customer_id?: unknown; to_customer_id?: unknown } | null
      return [d?.from_customer_id, d?.to_customer_id]
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  // Non-UUID ids (the '-' sentinel; any other malformed id) simply never
  // resolve — their rows keep showing the raw value, same honest-state
  // fallback as a purged customer or a failed batch call below.
  const allCustomerIds = [
    ...new Set([...customerIds, ...karuteCustomerIds, ...karuteCustomerById.values(), ...reassignCustomerIds]),
  ].filter((id) => UUID_RE.test(id))
  if (allCustomerIds.length > 0) {
    try {
      const { customers } = await synqed.customers.list({
        ids: allCustomerIds,
        include_deleted: true,
      })
      const nameById = new Map(customers.map((c) => [c.id, c.name]))
      for (const id of customerIds) {
        const name = nameById.get(id)
        if (name) labels[id] = name
      }
      for (const id of reassignCustomerIds) {
        const name = nameById.get(id)
        if (name) labels[id] = name
      }
      for (const e of events) {
        if (e.target_type !== 'karute' || !e.target_id) continue
        const cid =
          (e.detail as { customer_id?: unknown } | null)?.customer_id ??
          karuteCustomerById.get(e.target_id)
        const name = typeof cid === 'string' ? nameById.get(cid) : undefined
        if (name) labels[e.target_id] = name
      }
    } catch {
      /* ids remain */
    }
  }
  // settings.menu_update rows carry old/new store_id in DETAIL (not the
  // event's own target) when a menu's store assignment changes — those ids
  // need the same store-name resolution, so they widen the fetch trigger
  // alongside target_type 'store' rows below; stores.list() already returns
  // the whole business's stores unfiltered, so no extra fetch is needed once
  // triggered.
  const menuUpdateStoreIds = events
    .filter((e) => e.action === 'settings.menu_update')
    .flatMap((e) => {
      const d = e.detail as { store_id_old?: unknown; store_id_new?: unknown } | null
      return [d?.store_id_old, d?.store_id_new]
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (idsOf('store').length > 0 || menuUpdateStoreIds.length > 0) {
    try {
      const { stores } = await synqed.stores.list()
      for (const s of stores) labels[s.id] = s.name
    } catch {
      /* ids remain */
    }
  }
  // settings.menu_update's own target (target_type 'menu') — the edited
  // menu's name. list() returns the WHOLE catalog including retired rows
  // (listMenus's contract, src/actions/menus.ts), same unfiltered-fetch
  // shape as stores above, so a retired menu still resolves.
  if (idsOf('menu').length > 0) {
    try {
      const { menus } = await synqed.menus.list()
      for (const m of menus) labels[m.id] = m.name
    } catch {
      /* ids remain */
    }
  }
  // Staff targets live in TWO id spaces: rows stamp whatever id the roster
  // held at write time — the synqed-core staff.id while the member was
  // owner-created/unsigned-up, the Supabase profiles.id after signup (the
  // 7/28 field find: 北野's pre-signup staff.update row renders raw). Core's
  // staff row links both (user_id = profiles.id), so ONE unfiltered list —
  // no is_active filter, deactivated staff must keep resolving — maps either
  // spelling to a name. The component still prefers its live roster; this
  // fills what the roster can't key. Hard-deleted core rows simply don't
  // resolve — the id stands, same honest state as purged customers.
  const staffIds = idsOf('staff')
  if (staffIds.length > 0) {
    try {
      const staffNameById = new Map<string, string>()
      // Paginated walk (Greptile #639 r1+r2): the app's roster call sites
      // take a single 200-cap page, but historical audit rows outlive roster
      // caps — EVERY retained staff record must stay resolvable, so the page
      // count comes from the server's own total (no arbitrary cap to fall
      // off). The bound is computed ONCE from page 1 — finite even against a
      // server that keeps inflating total — and an empty page breaks early;
      // a missing/NaN total degrades to the single first page, ids remain.
      let expectedPages = 1
      for (let page = 1; page <= expectedPages; page++) {
        const res = await synqed.staff.list({ page, page_size: 200 })
        if (page === 1) expectedPages = Math.ceil(res.total / res.page_size)
        for (const s of res.staff) {
          staffNameById.set(s.id, s.name)
          if (s.user_id) staffNameById.set(s.user_id, s.name)
        }
        if (res.staff.length === 0) break
      }
      for (const id of staffIds) {
        const name = staffNameById.get(id)
        if (name) labels[id] = name
      }
    } catch {
      /* ids remain */
    }
  }
  return labels
}
