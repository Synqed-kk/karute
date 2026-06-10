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
        .select('pack_id')
        .eq('customer_id', customerId),
    ])
    if (pErr) throw pErr
    if (rErr) throw rErr
    const countByPack = new Map<string, number>()
    for (const r of (reds ?? []) as Array<{ pack_id: string }>) {
      countByPack.set(r.pack_id, (countByPack.get(r.pack_id) ?? 0) + 1)
    }
    return ((packs ?? []) as TicketPack[]).map((p) =>
      withUsage(p, countByPack.get(p.id) ?? 0),
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
}

/** Bulk pack usage for the customer LIST page — two queries total (not per
 *  customer), grouped in memory. Map is empty until the migration applies. */
export async function listAllPackUsage(): Promise<Map<string, CustomerPackUsage>> {
  const map = new Map<string, CustomerPackUsage>()
  try {
    const supabase = createServiceClient()
    const [{ data: packs, error: pErr }, { data: reds, error: rErr }] = await Promise.all([
      supabase
        .from('ticket_packs')
        .select('id, customer_id, kind, pack_size, unit_price')
        .eq('status', 'active'),
      supabase.from('pack_redemptions').select('pack_id'),
    ])
    if (pErr) throw pErr
    if (rErr) throw rErr
    const countByPack = new Map<string, number>()
    for (const r of (reds ?? []) as Array<{ pack_id: string }>) {
      countByPack.set(r.pack_id, (countByPack.get(r.pack_id) ?? 0) + 1)
    }
    for (const p of (packs ?? []) as Array<
      Pick<TicketPack, 'id' | 'customer_id' | 'kind' | 'pack_size' | 'unit_price'>
    >) {
      if (p.kind !== 'pack') continue
      const remaining = Math.max(0, p.pack_size - (countByPack.get(p.id) ?? 0))
      const cur = map.get(p.customer_id) ?? {
        remaining: 0,
        size: 0,
        unconsumed: 0,
        hasActivePack: false,
      }
      cur.remaining += remaining
      cur.size += p.pack_size
      cur.unconsumed += remaining * p.unit_price
      cur.hasActivePack = true
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
    const { data, error } = await supabase
      .from('customer_lifecycle')
      .select('customer_id, status, referral')
    if (error) throw error
    for (const row of (data ?? []) as CustomerLifecycle[]) map.set(row.customer_id, row)
    return map
  } catch (err) {
    warn('listAllLifecycles', err)
    return map
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
): Promise<{ ok: boolean }> {
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('customer_lifecycle').upsert({
      customer_id: customerId,
      status,
      referral,
      updated_by: updatedBy ?? null,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error
    return { ok: true }
  } catch (err) {
    warn('setCustomerLifecycle', err)
    return { ok: false }
  }
}
