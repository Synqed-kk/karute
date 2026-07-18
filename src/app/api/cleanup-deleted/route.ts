import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { newSynqedClient } from '@/lib/synqed/client'
import { paginateDedupe } from '@/lib/customers/paginate'
import { hardDeleteDeadlineMs } from '@/lib/customers/deletion'
import { audit } from '@/lib/audit'

// Own budget, separate from /api/cleanup — a long purge night must not starve
// the recordings/AI-cache jobs (or vice versa). Loop is deadline-checked so we
// exit cleanly instead of being killed mid-customer.
export const maxDuration = 300
const DEADLINE_HEADROOM_MS = 60_000

/**
 * Nightly hard-delete sweep (02:00 JST — quiet hours, minimizes the
 * undo-vs-sweep race window): customers whose 30-day soft-delete window
 * (core deleted_at, #51) has expired are permanently erased.
 *
 * Order per customer, and why:
 *   1. re-fetch — an undo may have raced the sweep since the list snapshot;
 *      skip unless deleted_at is still set AND still due.
 *   2. purge karute records + recording sessions via SDK — these have NO FK
 *      to customers in core (bare customer_id columns), so core's delete
 *      cascade can't reach them and they'd survive as orphaned PII.
 *   3. customers.delete — core cascades appointments/lifecycle/photos/
 *      consents/visits in one transaction and scrubs the customer's audit
 *      rows (SECURITY DEFINER, target hashed).
 *   4. straggler pass — a karute record created between (2) and (3) would be
 *      orphaned PII; one re-list catches it.
 *   5. audit privacy.customer_delete_executed (system actor, counts only).
 *
 * Failures are per-customer: one bad row never stops the sweep, and anything
 * skipped or timed out is due again next night by construction.
 *
 * Auth = CRON_SECRET, fail closed (same contract as /api/cleanup).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const deadline = Date.now() + maxDuration * 1000 - DEADLINE_HEADROOM_MS
  const stats = {
    businesses: 0,
    businessesTotal: 0,
    due: 0,
    executed: 0,
    skippedRestored: 0,
    failures: 0,
    timedOut: false,
  }

  // Business enumeration: distinct business_id across staff profiles (the
  // app-side table that knows every tenant). ponytail: a tenant whose staff
  // profiles were ALL removed is invisible here — core-side sweep endpoint is
  // the airtight fix, filed in the Anthony ask.
  const supabase = createServiceClient()
  const { data: rows, error } = await supabase
    .from('profiles')
    .select('business_id')
    .not('business_id', 'is', null)
  if (error) {
    console.error('[cleanup-deleted] profiles enumeration failed:', error)
    return NextResponse.json({ error: 'enumeration_failed' }, { status: 500 })
  }
  const businessIds = [...new Set((rows ?? []).map((r) => r.business_id).filter(Boolean))]
  stats.businessesTotal = businessIds.length
  // Shuffle so a nightly timeout never starves the same tail tenants forever.
  businessIds.sort(() => Math.random() - 0.5)

  for (const businessId of businessIds) {
    if (Date.now() > deadline) {
      stats.timedOut = true
      break
    }
    try {
      const synqed = newSynqedClient(businessId)
      // include_deleted returns actives too — page to completion (core clamps
      // page_size at 500; a single call silently drops the tail).
      const customers = await paginateDedupe((page) =>
        synqed.customers
          .list({ include_deleted: true, page, page_size: 500 })
          .then((r) => ({ items: r.customers, total: r.total })),
      )
      // Truthy guard is load-bearing: deleted_at is null for every active
      // customer, and new Date(null) is 1970 — "due" for the entire tenant.
      const due = customers.filter((c) => {
        const deletedAt = (c as { deleted_at?: string | null }).deleted_at
        return Boolean(deletedAt) && hardDeleteDeadlineMs(deletedAt!) <= Date.now()
      })
      stats.due += due.length

      for (const customer of due) {
        if (Date.now() > deadline) {
          stats.timedOut = true
          break
        }
        try {
          // (1) undo may have raced us since the list snapshot — re-check.
          // Fail CLOSED like the due filter: an unparseable fresh timestamp
          // (NaN deadline) skips, it never falls through to destruction.
          const fresh = await synqed.customers.get(customer.id)
          const freshDeletedAt = (fresh as { deleted_at?: string | null }).deleted_at
          const freshDeadline = freshDeletedAt ? hardDeleteDeadlineMs(freshDeletedAt) : NaN
          if (!Number.isFinite(freshDeadline) || freshDeadline > Date.now()) {
            stats.skippedRestored++
            continue
          }

          // (2) orphan-PII purge (no FK to customers in core). Helpers THROW
          // on deadline or pass-bound exhaustion — the catch below leaves the
          // customer soft-deleted, genuinely due again next night.
          const karuteDeleted = await purgeKaruteRecords(synqed, customer.id, deadline)
          const recordingsDeleted = await purgeRecordings(synqed, customer.id, deadline)
          const memoryDeleted = await purgeMemoryItems(synqed, customer.id)

          // (3) the hard delete — core owns the cascade + audit scrub. Bail
          // first if the remaining budget can't cover delete + audit; a kill
          // BETWEEN purge and delete is the one state that self-heals worst.
          if (Date.now() > deadline - 10_000) {
            stats.timedOut = true
            break
          }
          await synqed.customers.delete(customer.id)

          // (4) the surviving trail, IMMEDIATELY after the destruction it
          // records — nothing may sit between them (a straggler-pass throw
          // must not suppress the execution record). ids + counts only.
          audit({
            category: 'privacy',
            action: 'privacy.customer_delete_executed',
            actorId: null,
            actorType: 'system',
            businessId,
            targetType: 'customer',
            targetId: customer.id,
            severity: 'warning',
            detail: {
              karute_records: karuteDeleted,
              recordings: recordingsDeleted,
              memory_items: memoryDeleted,
            },
            source: 'system',
          })
          stats.executed++

          // (5) stragglers created during the purge gap — best-effort only.
          try {
            await purgeKaruteRecords(synqed, customer.id, deadline)
          } catch (err) {
            console.error('[cleanup-deleted] straggler pass failed:', customer.id, err)
          }
        } catch (err) {
          stats.failures++
          console.error('[cleanup-deleted] customer failed:', businessId, customer.id, err)
        }
      }
      stats.businesses++
    } catch (err) {
      stats.failures++
      console.error('[cleanup-deleted] business failed:', businessId, err)
    }
  }

  // Kill the 60s ghost window in the customer caches after a purge night.
  // (revalidateTag, NOT updateTag — updateTag throws in route handlers.)
  if (stats.executed > 0) revalidateTag('customers', 'max')

  console.log(JSON.stringify({ evt: 'cleanup_deleted_run', ...stats }))
  return NextResponse.json(stats)
}

/** Delete every karute record for a customer; self-paginating (each pass
 *  deletes what it listed, so the next list starts fresh). Returns count.
 *  THROWS on deadline or pass-bound exhaustion — proceeding to the customer
 *  hard delete with records remaining would orphan them forever (once the
 *  customer row is gone no future sweep can find them). A throw leaves the
 *  customer soft-deleted: due again next night. */
async function purgeKaruteRecords(
  synqed: ReturnType<typeof newSynqedClient>,
  customerId: string,
  deadline: number,
): Promise<number> {
  let deleted = 0
  // Bounded: 20 passes × 200 = 4000 records, far past any real customer.
  for (let pass = 0; pass < 20; pass++) {
    if (Date.now() > deadline) throw new Error('purge deadline exceeded')
    const { karute_records } = await synqed.karuteRecords.list({
      customer_id: customerId,
      page_size: 200,
    })
    if (karute_records.length === 0) return deleted
    for (const record of karute_records) {
      await synqed.karuteRecords.delete(record.id)
      deleted++
    }
  }
  const { karute_records: remaining } = await synqed.karuteRecords.list({
    customer_id: customerId,
    page_size: 1,
  })
  if (remaining.length > 0) throw new Error('karute purge exhausted with records remaining')
  return deleted
}

/** Memory items: SDK delete is core-side SOFT delete (rows hidden from every
 *  read, content unreachable via API). Hard scrub of the hidden rows at
 *  customer-erasure is the core-side cascade ask (Anthony list). */
async function purgeMemoryItems(
  synqed: ReturnType<typeof newSynqedClient>,
  customerId: string,
): Promise<number> {
  const { items } = await synqed.customerMemory.list(customerId)
  let deleted = 0
  for (const item of items) {
    await synqed.customerMemory.delete(item.id)
    deleted++
  }
  return deleted
}

/** Same self-paginating purge for recording sessions (transcript PII) — same
 *  throw-on-incomplete contract as purgeKaruteRecords. */
async function purgeRecordings(
  synqed: ReturnType<typeof newSynqedClient>,
  customerId: string,
  deadline: number,
): Promise<number> {
  let deleted = 0
  for (let pass = 0; pass < 20; pass++) {
    if (Date.now() > deadline) throw new Error('purge deadline exceeded')
    const { recordings } = await synqed.recordings.list({
      customer_id: customerId,
      page_size: 200,
    })
    if (recordings.length === 0) return deleted
    for (const recording of recordings) {
      await synqed.recordings.delete(recording.id)
      deleted++
    }
  }
  const { recordings: remaining } = await synqed.recordings.list({
    customer_id: customerId,
    page_size: 1,
  })
  if (remaining.length > 0) throw new Error('recording purge exhausted with sessions remaining')
  return deleted
}
