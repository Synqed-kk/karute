import { createServiceClient } from '@/lib/supabase/service'
import {
  withUsage,
  type CustomerLifecycle,
  type PackSource,
  type PackWithUsage,
  type TicketPack,
} from './types'

/**
 * 回数券 data access — service-role client, server-only (the tables are
 * RLS-locked with no public policies; auth + tenant are enforced in the
 * server actions that call this).
 *
 * GRACEFUL DEGRADATION (same contract as ai-cache): the tables ship in
 * supabase/migrations/20260610000000_ticket_packs.sql and don't exist on the
 * live DB until Anthony applies it. Every read returns a safe empty value and
 * every write reports { ok: false } instead of throwing, so the UI renders its
 * empty/error states rather than crashing.
 */

const warn = (fn: string, err: unknown) =>
  console.warn(`[packs] ${fn} failed (table missing until migration applies?):`, err)

/** All of a customer's packs (newest first) with redemption counts folded in. */
export async function listCustomerPacks(customerId: string): Promise<PackWithUsage[]> {
  if (!customerId) return []
  try {
    const supabase = createServiceClient()
    const [{ data: packs, error: pErr }, { data: reds, error: rErr }] = await Promise.all([
      supabase
        .from('ticket_packs')
        .select('*')
        .eq('customer_id', customerId)
        .order('purchased_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('pack_redemptions')
        .select('pack_id, redeemed_on')
        .eq('customer_id', customerId),
    ])
    if (pErr) throw pErr
    if (rErr) throw rErr
    const countByPack = new Map<string, number>()
    const lastByPack = new Map<string, string>()
    for (const r of (reds ?? []) as Array<{ pack_id: string; redeemed_on: string }>) {
      countByPack.set(r.pack_id, (countByPack.get(r.pack_id) ?? 0) + 1)
      const cur = lastByPack.get(r.pack_id)
      if (!cur || r.redeemed_on > cur) lastByPack.set(r.pack_id, r.redeemed_on)
    }
    return ((packs ?? []) as TicketPack[]).map((p) =>
      withUsage(p, countByPack.get(p.id) ?? 0, lastByPack.get(p.id) ?? null),
    )
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
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('ticket_packs')
      .insert({
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
      .select('id')
      .single()
    if (error) throw error
    return { ok: true, id: (data as { id: string }).id }
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
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('ticket_packs')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', packId)
    if (error) throw error
    return { ok: true }
  } catch (err) {
    warn('updatePackStatus', err)
    return { ok: false }
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
}

/** Check one session off a pack. The caller decides WHEN consumption happens
 *  (manual check-off in P1; auto-on-visit is a later wiring decision). */
export async function addRedemption(
  input: AddRedemptionInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('pack_redemptions')
      .insert({
        pack_id: input.packId,
        customer_id: input.customerId,
        redeemed_on: input.redeemedOn,
        appointment_id: input.appointmentId ?? null,
        karute_record_id: input.karuteRecordId ?? null,
        source: input.source ?? 'manual',
        created_by: input.createdBy ?? null,
      })
      .select('id')
      .single()
    if (error) throw error
    return { ok: true, id: (data as { id: string }).id }
  } catch (err) {
    warn('addRedemption', err)
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}

export async function removeRedemption(redemptionId: string): Promise<{ ok: boolean }> {
  try {
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('pack_redemptions')
      .delete()
      .eq('id', redemptionId)
    if (error) throw error
    return { ok: true }
  } catch (err) {
    warn('removeRedemption', err)
    return { ok: false }
  }
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

/** Bulk pack usage for the customer LIST page — two queries total (not per
 *  customer), grouped in memory. Map is empty until the migration applies. */
/** Range-paginate past PostgREST's SILENT 1,000-row cap. Every bulk read in
 *  this store must go through this: the cap is invisible (no error, no
 *  warning) — an unpaginated redemption read showed 残3/3 on the list while
 *  the profile's per-customer read correctly said 残り2回, and inflated the
 *  strip's 未消化¥ and the alert engine's inputs. */
async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw error
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

export async function listAllPackUsage(): Promise<Map<string, CustomerPackUsage>> {
  const map = new Map<string, CustomerPackUsage>()
  try {
    const supabase = createServiceClient()
    const [packs, reds] = await Promise.all([
      pageAll<Pick<TicketPack, 'id' | 'customer_id' | 'kind' | 'pack_size' | 'unit_price'>>(
        (from, to) =>
          supabase
            .from('ticket_packs')
            .select('id, customer_id, kind, pack_size, unit_price')
            .eq('status', 'active')
            .order('id')
            .range(from, to),
      ),
      pageAll<{ pack_id: string }>((from, to) =>
        supabase.from('pack_redemptions').select('pack_id').order('id').range(from, to),
      ),
    ])
    const countByPack = new Map<string, number>()
    for (const r of reds) {
      countByPack.set(r.pack_id, (countByPack.get(r.pack_id) ?? 0) + 1)
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
  } catch (err) {
    warn('listAllPackUsage', err)
    return map
  }
}

/** Bulk lifecycle for the list page — graduated/lost customers are excluded
 *  from alerts. Empty map until the migration applies. */
export async function listAllLifecycles(): Promise<Map<string, CustomerLifecycle>> {
  const map = new Map<string, CustomerLifecycle>()
  try {
    const supabase = createServiceClient()
    const rows = await pageAll<CustomerLifecycle>((from, to) =>
      supabase
        .from('customer_lifecycle')
        .select('customer_id, status, referral')
        .order('customer_id')
        .range(from, to),
    )
    for (const row of rows) map.set(row.customer_id, row)
    return map
  } catch (err) {
    warn('listAllLifecycles', err)
    return map
  }
}

/** Customers with an ACTIVE alert dismissal (no expiry, or expiry in the
 *  future). The 要連絡 alert list excludes them — Kitano's rule: only a manager
 *  dismisses, with an audit trail. Empty until the migration applies. */
export async function listActiveDismissals(): Promise<Set<string>> {
  const set = new Set<string>()
  try {
    const supabase = createServiceClient()
    const rows = await pageAll<{ customer_id: string; expires_at: string | null }>(
      (from, to) =>
        supabase
          .from('pack_alert_dismissals')
          .select('customer_id, expires_at')
          .order('customer_id')
          .range(from, to),
    )
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
    const supabase = createServiceClient()
    const { error } = await supabase.from('pack_alert_dismissals').insert({
      customer_id: input.customerId,
      dismissed_by: input.dismissedBy,
      reason: input.reason ?? null,
      expires_at: input.expiresAt ?? null,
    })
    if (error) throw error
    return { ok: true }
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
    const supabase = createServiceClient()
    const { error } = await supabase.from('customer_contacts').insert({
      customer_id: input.customerId,
      channel: input.channel,
      alert_kind: input.alertKind ?? null,
      note: input.note ?? null,
      contacted_by: input.contactedBy,
    })
    if (error) throw error
    return { ok: true }
  } catch (err) {
    warn('addCustomerContact', err)
    return { ok: false }
  }
}

/** Recent contact attempts (newest first) — feeds the 対応中 snooze on the
 *  alert card + the monthly 対応→再来店 metric. Empty until migration applies. */
export async function listRecentContacts(
  sinceDays: number,
): Promise<Array<{ customer_id: string; contacted_at: string }>> {
  try {
    const supabase = createServiceClient()
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
    return await pageAll<{ customer_id: string; contacted_at: string }>((from, to) =>
      supabase
        .from('customer_contacts')
        .select('customer_id, contacted_at')
        .gte('contacted_at', since)
        .order('contacted_at', { ascending: false })
        .range(from, to),
    )
  } catch (err) {
    warn('listRecentContacts', err)
    return []
  }
}

/** Redemptions in the last N days — feeds the 未処理来店 reconciler's
 *  "was this visit ticked off?" check. Paginated; empty until data exists. */
export async function listRecentRedemptions(
  sinceDays: number,
): Promise<Array<{ customer_id: string; appointment_id: string | null; redeemed_on: string }>> {
  try {
    const supabase = createServiceClient()
    const since = new Date(Date.now() - sinceDays * 86_400_000)
      .toISOString()
      .slice(0, 10)
    return await pageAll<{
      customer_id: string
      appointment_id: string | null
      redeemed_on: string
    }>((from, to) =>
      supabase
        .from('pack_redemptions')
        .select('customer_id, appointment_id, redeemed_on')
        .gte('redeemed_on', since)
        .order('redeemed_on')
        .range(from, to),
    )
  } catch (err) {
    warn('listRecentRedemptions', err)
    return []
  }
}

/** 来店なし answer for a flagged 未処理来店 — stops the reconcile row from
 *  re-surfacing. Any staff; audit-trailed. No-op until migration applies. */
export async function addVisitReconcileDismissal(input: {
  customerId: string
  appointmentId?: string | null
  visitDay: string // yyyy-mm-dd
  dismissedBy: string
  reason?: string | null
}): Promise<{ ok: boolean }> {
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('visit_reconcile_dismissals').insert({
      customer_id: input.customerId,
      appointment_id: input.appointmentId ?? null,
      visit_day: input.visitDay,
      dismissed_by: input.dismissedBy,
      reason: input.reason ?? null,
    })
    if (error) throw error
    return { ok: true }
  } catch (err) {
    warn('addVisitReconcileDismissal', err)
    return { ok: false }
  }
}

/** Recent 来店なし dismissals — the reconcile detector excludes these visits.
 *  Empty until migration applies. */
export async function listVisitReconcileDismissals(
  sinceDays: number,
): Promise<Array<{ customer_id: string; appointment_id: string | null; visit_day: string }>> {
  try {
    const supabase = createServiceClient()
    const since = new Date(Date.now() - sinceDays * 86_400_000)
      .toISOString()
      .slice(0, 10)
    return await pageAll<{
      customer_id: string
      appointment_id: string | null
      visit_day: string
    }>((from, to) =>
      supabase
        .from('visit_reconcile_dismissals')
        .select('customer_id, appointment_id, visit_day')
        .gte('visit_day', since)
        .order('visit_day')
        .range(from, to),
    )
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
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('customer_lifecycle')
      .select('customer_id, status, referral')
      .eq('customer_id', customerId)
      .maybeSingle()
    if (error) throw error
    return (data as CustomerLifecycle | null) ?? null
  } catch (err) {
    warn('getCustomerLifecycle', err)
    return null
  }
}

export async function setCustomerLifecycle(
  customerId: string,
  status: CustomerLifecycle['status'],
  referral: boolean,
  updatedBy?: string | null,
  reason?: string | null,
): Promise<{ ok: boolean }> {
  try {
    const supabase = createServiceClient()
    // status_changed_at is the churn-model LABEL DATE — written only on an
    // actual status transition (a blind upsert would overwrite it on every
    // referral toggle and destroy the history).
    const { data: existing } = await supabase
      .from('customer_lifecycle')
      .select('status')
      .eq('customer_id', customerId)
      .maybeSingle()
    const statusChanged =
      (existing as { status?: string } | null)?.status !== status
    const { error } = await supabase.from('customer_lifecycle').upsert({
      customer_id: customerId,
      status,
      referral,
      updated_by: updatedBy ?? null,
      updated_at: new Date().toISOString(),
      ...(statusChanged
        ? {
            status_changed_at: new Date().toISOString(),
            reason: reason ?? null,
          }
        : {}),
    })
    if (error) throw error
    return { ok: true }
  } catch (err) {
    warn('setCustomerLifecycle', err)
    return { ok: false }
  }
}
