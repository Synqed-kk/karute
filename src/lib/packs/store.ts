import type { SynqedClient } from '@synqed-kk/client'
import { getSynqedClient } from '@/lib/synqed/client'
import { ymdInJst } from '@/lib/date/jst'
import { isTerminalStatus } from '@/lib/appointments/status'
import {
  withUsage,
  type CustomerLifecycle,
  type PackSource,
  type PackWithUsage,
  type TicketPack,
} from './types'

/**
 * 回数券 data access — backed by synqed-core (business-scoped via the SDK's
 * x-business-id). server-only; the server actions that call this enforce auth.
 *
 * GRACEFUL DEGRADATION (same contract as ai-cache): every read returns a safe
 * empty value and every write reports { ok: false } instead of throwing, so the
 * UI renders its empty/error states rather than crashing if core is unreachable.
 */

const warn = (fn: string, err: unknown) => console.warn(`[packs] ${fn} failed:`, err)

/** Client-threaded core of listCustomerPacks — takes an EXPLICIT business-scoped
 *  client (facade Bearer path). THROWS on failure (the facade caller decides
 *  graceful vs 502; packet 06 keeps packs page-parity graceful). */
export async function listCustomerPacksWithClient(
  synqed: Pick<SynqedClient, 'packs'>,
  customerId: string,
): Promise<PackWithUsage[]> {
  const [packs, reds] = await Promise.all([
    synqed.packs.listPacks(customerId),
    synqed.packs.listRedemptions(customerId),
  ])
  const countByPack = new Map<string, number>()
  const lastByPack = new Map<string, string>()
  for (const r of reds) {
    countByPack.set(r.pack_id, (countByPack.get(r.pack_id) ?? 0) + 1)
    const cur = lastByPack.get(r.pack_id)
    if (!cur || r.redeemed_on > cur) lastByPack.set(r.pack_id, r.redeemed_on)
  }
  return (packs as unknown as TicketPack[]).map((p) =>
    withUsage(p, countByPack.get(p.id) ?? 0, lastByPack.get(p.id) ?? null),
  )
}

/** All of a customer's packs (newest first) with redemption counts folded in. */
export async function listCustomerPacks(customerId: string): Promise<PackWithUsage[]> {
  if (!customerId) return []
  try {
    return await listCustomerPacksWithClient(await getSynqedClient(), customerId)
  } catch (err) {
    warn('listCustomerPacks', err)
    return []
  }
}

export interface CreatePackInput {
  customerId: string
  kind: TicketPack['kind']
  packSize: number
  unitPrice: number
  totalPrice?: number | null
  purchaseRound?: number
  purchasedAt?: string | null
  source?: TicketPack['source']
  notes?: string | null
  createdBy?: string | null
}

export async function createPack(
  input: CreatePackInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return createPackWithClient(await getSynqedClient(), input)
}

/** Business-scoped create — the facade path (Bearer client), single-sourced with
 *  the cookie createPack above. */
export async function createPackWithClient(
  synqed: Pick<SynqedClient, 'packs'>,
  input: CreatePackInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const pack = await synqed.packs.createPack({
      customer_id: input.customerId,
      kind: input.kind,
      pack_size: input.packSize,
      unit_price: input.unitPrice,
      total_price: input.totalPrice ?? null,
      purchase_round: input.purchaseRound ?? 0,
      purchased_at: input.purchasedAt ?? null,
      source: input.source ?? 'manual',
      notes: input.notes ?? null,
      created_by: input.createdBy ?? null,
    })
    return { ok: true, id: pack.id }
  } catch (err) {
    warn('createPack', err)
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

export async function updatePackStatus(
  packId: string,
  status: TicketPack['status'],
): Promise<{ ok: boolean }> {
  try {
    const synqed = await getSynqedClient()
    return await synqed.packs.updatePackStatus(packId, status)
  } catch (err) {
    warn('updatePackStatus', err)
    return { ok: false }
  }
}

/** The customer's appointment on `dateYmd` (JST calendar day) to link a
 *  redemption to when the caller didn't supply one — same customer_id +
 *  JST-day window as getAppointmentsByDate/reconcile.ts, but scoped to the one
 *  customer server-side so it's a single small page and immune to the agenda's
 *  active-store view filter (a profile burn isn't store-scoped). Non-cancelled
 *  bookings only (CANCELLED or NO_SHOW never match) — mirrors
 *  getAppointmentsByDate. Multiple same-day
 *  bookings: pick the one closest to now (the next upcoming), else — if every
 *  booking that day has already passed — the day's first. null when there's no
 *  booking that day — a valid walk-in, not an error. */
export async function findCustomerAppointmentForDate(
  customerId: string,
  dateYmd: string,
): Promise<string | null> {
  return findCustomerAppointmentForDateWithClient(await getSynqedClient(), customerId, dateYmd)
}

/** Business-scoped appointment-of-day lookup — the facade burn-pairing path
 *  (Bearer client), single-sourced with the cookie wrapper above. */
export async function findCustomerAppointmentForDateWithClient(
  synqed: Pick<SynqedClient, 'appointments'>,
  customerId: string,
  dateYmd: string,
): Promise<string | null> {
  try {
    const dayStartUTC = new Date(`${dateYmd}T00:00:00+09:00`)
    const dayEndUTC = new Date(`${dateYmd}T23:59:59.999+09:00`)
    const { appointments } = await synqed.appointments.list({
      customer_id: customerId,
      from: dayStartUTC.toISOString(),
      to: dayEndUTC.toISOString(),
      page_size: 200,
    })
    const candidates = appointments
      .filter((a) => !isTerminalStatus(a.status))
      .sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0))
    if (candidates.length === 0) return null
    const nowIso = new Date().toISOString()
    return (candidates.find((a) => a.starts_at >= nowIso) ?? candidates[0]).id
  } catch (err) {
    warn('findCustomerAppointmentForDate', err)
    return null
  }
}

export interface AddRedemptionInput {
  packId: string
  customerId: string
  redeemedOn: string // yyyy-mm-dd
  appointmentId?: string | null
  karuteRecordId?: string | null
  source?: PackSource
  createdBy?: string | null
  /** Whether this redemption counts as a completed visit — core defaults
   *  true, so omit for the normal check-off. A no-show burn MUST send false:
   *  the ticket is spent but no visit happened, so visit-count-driven surfaces
   *  (lifecycle, dormancy) must not treat it as one. */
  countsAsVisit?: boolean
}

/** Check one session off a pack. The caller decides WHEN consumption happens
 *  (manual check-off in P1; auto-on-visit is a later wiring decision). */
export async function addRedemption(
  input: AddRedemptionInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return addRedemptionWithClient(await getSynqedClient(), input)
}

/** Business-scoped redemption — the facade burn path (Bearer client), single-
 *  sourced with the cookie addRedemption above. Keeps the below-zero
 *  (double-burn / over-redeem) discriminator. */
export async function addRedemptionWithClient(
  synqed: Pick<SynqedClient, 'packs'>,
  input: AddRedemptionInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const payload = {
      pack_id: input.packId,
      customer_id: input.customerId,
      redeemed_on: input.redeemedOn,
      appointment_id: input.appointmentId ?? null,
      karute_record_id: input.karuteRecordId ?? null,
      source: input.source ?? 'manual',
      created_by: input.createdBy ?? null,
      ...(input.countsAsVisit === undefined ? {} : { counts_as_visit: input.countsAsVisit }),
    }
    // SDK-skew cast: @synqed-kk/client 1.11.0's addRedemption() type doesn't
    // declare counts_as_visit yet (synqed-core #39) — cast to send it.
    const { id } = await synqed.packs.addRedemption(
      payload as Parameters<typeof synqed.packs.addRedemption>[0],
    )
    return { ok: true, id }
  } catch (err) {
    warn('addRedemption', err)
    // Stable discriminator, NOT a user-facing string: every burn caller toasts
    // an i18n key (never res.error, which carries English internals), so it
    // branches on this to show the 残回数ゼロ message vs the generic failure.
    if (isBelowZeroGuardError(err)) {
      return { ok: false, error: 'below_zero' }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

/** trg_pack_below_zero (assert_pack_not_over_redeemed in the prod DB) raises
 *  `pack % over-redeemed: % burned > pack_size %` with SQLSTATE 23514. It
 *  reaches us as a SynqedError whose message is whatever core's onError relayed
 *  from Prisma — no structured code survives this HTTP boundary. 'over-redeemed'
 *  is the trigger's own raise text and the only part guaranteed present; the
 *  code/trigger-name matches cover Prisma formats that embed them. */
function isBelowZeroGuardError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return (
    message.includes('over-redeemed') ||
    message.includes('trg_pack_below_zero') ||
    message.includes('23514')
  )
}

export async function removeRedemption(redemptionId: string): Promise<{ ok: boolean }> {
  try {
    const synqed = await getSynqedClient()
    return await removeRedemptionWithClient(synqed, redemptionId)
  } catch (err) {
    warn('removeRedemption', err)
    return { ok: false }
  }
}

/** Client-threaded core of removeRedemption (packet 08 §Smaller pre-rulings). The
 *  business-scoped client IS the tenancy proof — a cross-tenant/missing
 *  redemptionId is not this business's row, so removeRedemption rejects it. THROWS
 *  on failure so the facade route classifies (404 vs 502); the web action keeps
 *  its graceful { ok:false } wrapper. */
export async function removeRedemptionWithClient(
  synqed: Pick<SynqedClient, 'packs'>,
  redemptionId: string,
): Promise<{ ok: boolean }> {
  return synqed.packs.removeRedemption(redemptionId)
}

export interface CustomerPackUsage {
  /** Remaining sessions across ACTIVE counted packs (kind='pack'). */
  remaining: number
  /** Σ pack_size across active counted packs — denominator for 残3/10. */
  size: number
  /** Σ remaining × unit_price across active counted packs (消化残高). */
  unconsumed: number
  hasActivePack: boolean
  /** First active counted pack with sessions left — the この日に消化 target. */
  firstPackId?: string | null
}

/** Bulk pack usage for the customer LIST page — two business-scoped reads,
 *  grouped in memory. core returns active packs FIFO-ordered.
 *  THROWS on failure (packet 04): the facade caller maps it to a classified
 *  502 — a mobile cache must never freeze a silent "no packs" empty. The web
 *  wrapper below keeps today's graceful-empty behavior. */
export async function listAllPackUsageWithClient(
  synqed: SynqedClient,
): Promise<Map<string, CustomerPackUsage>> {
  const map = new Map<string, CustomerPackUsage>()
  const [packs, redPackIds] = await Promise.all([
    synqed.packs.listActivePacks(),
    synqed.packs.listAllRedemptionPackIds(),
  ])
  const countByPack = new Map<string, number>()
  for (const pid of redPackIds) {
    countByPack.set(pid, (countByPack.get(pid) ?? 0) + 1)
  }
  for (const p of packs) {
    if (p.kind !== 'pack') continue
    const remaining = Math.max(0, p.pack_size - (countByPack.get(p.id) ?? 0))
    const cur = map.get(p.customer_id) ?? {
      remaining: 0,
      size: 0,
      unconsumed: 0,
      hasActivePack: false,
      firstPackId: null,
    }
    cur.remaining += remaining
    cur.size += p.pack_size
    cur.unconsumed += remaining * p.unit_price
    cur.hasActivePack = true
    if (remaining > 0 && !cur.firstPackId) cur.firstPackId = p.id
    map.set(p.customer_id, cur)
  }
  return map
}

export async function listAllPackUsage(): Promise<Map<string, CustomerPackUsage>> {
  try {
    return await listAllPackUsageWithClient(await getSynqedClient())
  } catch (err) {
    warn('listAllPackUsage', err)
    return new Map()
  }
}

/** Bulk lifecycle for the list page — graduated/lost customers are excluded
 *  from alerts. Throwing/graceful split identical to listAllPackUsage above. */
export async function listAllLifecyclesWithClient(
  synqed: SynqedClient,
): Promise<Map<string, CustomerLifecycle>> {
  const map = new Map<string, CustomerLifecycle>()
  const rows = await synqed.packs.listLifecycles()
  for (const row of rows) map.set(row.customer_id, row as CustomerLifecycle)
  return map
}

export async function listAllLifecycles(): Promise<Map<string, CustomerLifecycle>> {
  try {
    return await listAllLifecyclesWithClient(await getSynqedClient())
  } catch (err) {
    warn('listAllLifecycles', err)
    return new Map()
  }
}

/** Customers with an ACTIVE alert dismissal (no expiry, or expiry in the
 *  future). The 要連絡 alert list excludes them — Kitano's rule: only a manager
 *  dismisses, with an audit trail. */
export async function listActiveDismissals(): Promise<Set<string>> {
  const set = new Set<string>()
  try {
    const synqed = await getSynqedClient()
    const rows = await synqed.packs.listAlertDismissals()
    const now = Date.now()
    for (const row of rows) {
      if (row.expires_at === null || new Date(row.expires_at).getTime() > now) {
        set.add(row.customer_id)
      }
    }
    return set
  } catch (err) {
    warn('listActiveDismissals', err)
    return set
  }
}

export async function addPackAlertDismissal(input: {
  customerId: string
  dismissedBy: string
  reason?: string | null
  expiresAt?: string | null
}): Promise<{ ok: boolean }> {
  try {
    const synqed = await getSynqedClient()
    return await synqed.packs.addAlertDismissal({
      customer_id: input.customerId,
      dismissed_by: input.dismissedBy,
      reason: input.reason ?? null,
      expires_at: input.expiresAt ?? null,
    })
  } catch (err) {
    warn('addPackAlertDismissal', err)
    return { ok: false }
  }
}

export type ContactChannel = 'phone' | 'sms' | 'email' | 'line' | 'in_person'

/** Log a win-back contact attempt (the 連絡済み workflow). ANY staff — the
 *  outcome stream coaching trains on + the owner's effectiveness metric. */
export async function addCustomerContact(input: {
  customerId: string
  channel: ContactChannel
  alertKind?: string | null
  note?: string | null
  contactedBy: string
}): Promise<{ ok: boolean }> {
  try {
    const synqed = await getSynqedClient()
    return await synqed.packs.addContact({
      customer_id: input.customerId,
      channel: input.channel,
      alert_kind: input.alertKind ?? null,
      note: input.note ?? null,
      contacted_by: input.contactedBy,
    })
  } catch (err) {
    warn('addCustomerContact', err)
    return { ok: false }
  }
}

/** Recent contact attempts (newest first) — feeds the 対応中 snooze on the
 *  alert card + the monthly 対応→再来店 metric. */
export async function listRecentContacts(
  sinceDays: number,
): Promise<Array<{ customer_id: string; contacted_at: string }>> {
  try {
    const synqed = await getSynqedClient()
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
    return await synqed.packs.listRecentContacts(since)
  } catch (err) {
    warn('listRecentContacts', err)
    return []
  }
}

/** Redemptions in the last N JST calendar days INCLUDING today — feeds the
 *  未処理来店 reconciler's "was this visit ticked off?" check and the owner
 *  pulse. redeemed_on is a JST business date, so the cutoff must be JST too —
 *  the previous UTC cutoff made "7 days" span 8-9 JST days depending on the
 *  time of day. */
export async function listRecentRedemptions(
  sinceDays: number,
): Promise<Array<{ customer_id: string; appointment_id: string | null; redeemed_on: string }>> {
  try {
    const synqed = await getSynqedClient()
    const since = ymdInJst(new Date(Date.now() - (sinceDays - 1) * 86_400_000))
    return await synqed.packs.listRecentRedemptions(since)
  } catch (err) {
    warn('listRecentRedemptions', err)
    return []
  }
}

/** 来店なし answer for a flagged 未処理来店 — stops the reconcile row from
 *  re-surfacing. Any staff; audit-trailed. */
export async function addVisitReconcileDismissal(input: {
  customerId: string
  appointmentId?: string | null
  visitDay: string // yyyy-mm-dd
  dismissedBy: string
  reason?: string | null
}): Promise<{ ok: boolean }> {
  try {
    const synqed = await getSynqedClient()
    return await synqed.packs.addVisitDismissal({
      customer_id: input.customerId,
      appointment_id: input.appointmentId ?? null,
      visit_day: input.visitDay,
      dismissed_by: input.dismissedBy,
      reason: input.reason ?? null,
    })
  } catch (err) {
    warn('addVisitReconcileDismissal', err)
    return { ok: false }
  }
}

/** Recent 来店なし dismissals — the reconcile detector excludes these visits. */
export async function listVisitReconcileDismissals(
  sinceDays: number,
): Promise<Array<{ customer_id: string; appointment_id: string | null; visit_day: string }>> {
  try {
    const synqed = await getSynqedClient()
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10)
    return await synqed.packs.listVisitDismissals(since)
  } catch (err) {
    warn('listVisitReconcileDismissals', err)
    return []
  }
}

export async function getCustomerLifecycle(
  customerId: string,
): Promise<CustomerLifecycle | null> {
  if (!customerId) return null
  try {
    const synqed = await getSynqedClient()
    return (await synqed.packs.getLifecycle(customerId)) as CustomerLifecycle | null
  } catch (err) {
    warn('getCustomerLifecycle', err)
    return null
  }
}

/**
 * Lifecycle read that DISTINGUISHES "no lifecycle row" (a normal active
 * customer) from "the read failed". Coaching surfaces must fail CLOSED on
 * error: a transient backend hiccup on a 卒業/離客 customer must not render
 * closing tactics for someone the salon already released — treat an errored
 * read as "unknown, suppress coaching", never as "active".
 */
export async function getCustomerLifecycleChecked(
  customerId: string,
): Promise<{ ok: true; lifecycle: CustomerLifecycle | null } | { ok: false }> {
  if (!customerId) return { ok: true, lifecycle: null }
  try {
    return await getCustomerLifecycleCheckedWithClient(await getSynqedClient(), customerId)
  } catch (err) {
    warn('getCustomerLifecycleChecked', err)
    return { ok: false }
  }
}

/** Client-threaded checked read (facade Bearer path). Keeps the checked-read
 *  semantics EXACTLY (packet 06 §Build 2 exception): ok:false on an errored
 *  read → the caller suppresses the pace verdict + degrades display to null.
 *  That is product logic (never coach a possibly-released customer), NOT a
 *  swallowed failure — carried onto the facade deliberately. */
export async function getCustomerLifecycleCheckedWithClient(
  synqed: Pick<SynqedClient, 'packs'>,
  customerId: string,
): Promise<{ ok: true; lifecycle: CustomerLifecycle | null } | { ok: false }> {
  if (!customerId) return { ok: true, lifecycle: null }
  try {
    const lifecycle = (await synqed.packs.getLifecycle(customerId)) as CustomerLifecycle | null
    return { ok: true, lifecycle }
  } catch (err) {
    warn('getCustomerLifecycleChecked', err)
    return { ok: false }
  }
}

export async function setCustomerLifecycle(
  customerId: string,
  status: CustomerLifecycle['status'],
  referral: boolean,
  updatedBy?: string | null,
  reason?: string | null,
): Promise<{ ok: boolean }> {
  return setCustomerLifecycleWithClient(
    await getSynqedClient(),
    customerId,
    status,
    referral,
    updatedBy,
    reason,
  )
}

/** Business-scoped lifecycle set — the facade path (Bearer client), single-
 *  sourced with the cookie setCustomerLifecycle above. */
export async function setCustomerLifecycleWithClient(
  synqed: Pick<SynqedClient, 'packs'>,
  customerId: string,
  status: CustomerLifecycle['status'],
  referral: boolean,
  updatedBy?: string | null,
  reason?: string | null,
): Promise<{ ok: boolean }> {
  try {
    // status_changed_at (the churn-model LABEL DATE) is written server-side only
    // on an actual status transition — core handles that in setLifecycle.
    return await synqed.packs.setLifecycle({
      customer_id: customerId,
      status,
      referral,
      updated_by: updatedBy ?? null,
      reason: reason ?? null,
    })
  } catch (err) {
    warn('setCustomerLifecycle', err)
    return { ok: false }
  }
}
