import { NextRequest, NextResponse } from 'next/server'
import { SynqedClient, SynqedError } from '@synqed-kk/client'
import { createServiceClient } from '@/lib/supabase/service'
import { getBusinessId } from '@/lib/staff'
import { qrLogin, qrGetReservations, mapReservation } from '@/lib/quickreserve'

export const maxDuration = 300

/**
 * Sync bookings from Quick Reserve into synqed-core (the source of truth the
 * app reads from). Called by Vercel cron (daily) or manually.
 *
 * `sync_config` (provider credentials + last-run status) still lives in
 * Supabase — it's config, not customer/booking data. Everything the app
 * actually renders — customers, staff matching, appointments — goes through
 * synqed-core. Writing to the legacy Supabase tables here would land bookings
 * in tables nobody reads post-migration (they'd never show in the UI).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Cron only runs when auto-sync is enabled.
  const syncResult = await runSync({ requireEnabled: true })

  // Also run cleanup on cron
  try {
    const cleanupRes = await fetch(new URL('/api/cleanup', request.url))
    console.log('[Cron] Cleanup:', await cleanupRes.json())
  } catch {}

  return syncResult
}

// Manual "Sync now" from Settings runs regardless of the auto-sync toggle —
// `enabled` only gates the cron, not an explicit user-initiated sync.
export async function POST() {
  return runSync({ requireEnabled: false })
}

async function runSync({ requireEnabled }: { requireEnabled: boolean }) {
  // sync_config (credentials + run status) stays in Supabase — it's config.
  const supabase = createServiceClient()

  try {
    let query = supabase
      .from('sync_config')
      .select('*')
      .eq('provider', 'quickreserve')
    if (requireEnabled) query = query.eq('enabled', true)
    const { data: config } = await query.single()

    if (!config) {
      return NextResponse.json({
        message: requireEnabled
          ? 'QR sync not configured or disabled'
          : 'QR sync not configured — save your Quick Reserve login first',
      })
    }

    // synqed-core is business-scoped, so the sync needs the target business id.
    // Cron (no user session) must read it from the config row; a manual sync is
    // initiated by the signed-in owner, so fall back to their business when the
    // config row carries none. getBusinessId() returns the same id the app reads
    // with, so synced bookings land in the tenant the UI actually shows.
    const businessId = config.business_id || (requireEnabled ? null : await getBusinessId())
    if (!businessId) {
      return NextResponse.json(
        { error: 'QR sync requires business_id on sync_config (synqed-core is business-scoped)' },
        { status: 400 },
      )
    }
    const baseUrl = process.env.SYNQED_CORE_URL
    const apiKey = process.env.SYNQED_CORE_API_KEY
    if (!baseUrl || !apiKey) {
      return NextResponse.json(
        { error: 'Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY' },
        { status: 500 },
      )
    }
    const synqed = new SynqedClient({ baseUrl, apiKey, businessId })

    // Login
    const session = await qrLogin(config.username, config.password_encrypted)

    // Sync window: today + the next SYNC_DAYS_AHEAD days, all in JST. QR's
    // endpoint and the synqed dedup are both per-day, so we iterate calendar
    // days rather than one wide range — this also keeps each day's existing-
    // appointments lookup under synqed's 200-row page cap.
    const SYNC_DAYS_AHEAD = 14
    const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const baseDate = nowJst.toISOString().split('T')[0] // today (JST) as YYYY-MM-DD
    const baseUtcMidnight = new Date(`${baseDate}T00:00:00Z`).getTime()
    const dates = Array.from({ length: SYNC_DAYS_AHEAD + 1 }, (_, i) =>
      new Date(baseUtcMidnight + i * 86400000).toISOString().split('T')[0],
    )

    const storeSlug = config.base_url || 'la-estro'
    const storeId = config.store_id || 222

    // synqed staff name → synqed staff id (synqed appointments FK on staff.id).
    // Fetched once and shared across the whole window.
    const { staff } = await synqed.staff.list({ page_size: 200 })
    const staffByName = new Map<string, string>()
    // synqed staff name → linked Supabase profile id (user_id). 指名 is stored
    // on Customer.assigned_staff_id, which the app reads as a profile id, so a
    // staff with no linked profile resolves to null and is skipped (no FK risk).
    const staffProfileIdByName = new Map<string, string | null>()
    for (const s of staff) {
      if (s.name) {
        staffByName.set(s.name, s.id)
        staffProfileIdByName.set(s.name, (s as { user_id?: string | null }).user_id ?? null)
      }
    }

    // QR staff id → name, accumulated from the schedule itself (every
    // reservation embeds its assigned Staff), so 指名 needs no separate roster
    // call. Resolves nominated_staff_id → name → synqed staff → profile id.
    const qrStaffNameById = new Map<number, string>()
    const resolveNominatedProfileId = (qrStaffId: number | null): string | null => {
      if (qrStaffId == null) return null
      const qrName = qrStaffNameById.get(qrStaffId)
      if (!qrName) return null
      for (const [name, profileId] of staffProfileIdByName) {
        if (name.includes(qrName) || qrName.includes(name)) return profileId
      }
      return null
    }

    // synqed customer name → id, for find-or-create. (synqed list caps at 200;
    // a tenant with >200 customers could create a duplicate for a name beyond
    // that window — acceptable for now, would need a name filter on the API.)
    const { customers: existingCustomers } = await synqed.customers.list({ page_size: 200 })
    const customerByName = new Map<string, string>()
    for (const c of existingCustomers) {
      if (c.name) customerByName.set(c.name, c.id)
    }

    const apptKey = (staffId: string, startsAt: string) =>
      `${staffId}|${new Date(startsAt).getTime()}`

    let created = 0
    let updated = 0
    let skipped = 0
    // Bookings synqed-core rejected as overlapping an existing slot (409).
    // Counted + skipped instead of crashing the whole run mid-way.
    let overlapped = 0
    let total = 0
    // Existing customers whose visit_count/is_existing_customer we've already
    // refreshed this run — keep returning customers' counts current without
    // re-updating them once per reservation.
    const refreshedCustomerIds = new Set<string>()

    for (const dateStr of dates) {
      let reservations
      try {
        reservations = await qrGetReservations(session, storeSlug, storeId, dateStr)
      } catch (err) {
        // One bad day shouldn't sink the rest of the window; dedup makes a
        // later re-sync of this day safe.
        console.error(`[QR Sync] Reservation fetch error for ${dateStr}:`, err)
        continue
      }
      total += reservations.length
      console.log('[QR Sync] Got', reservations.length, 'reservations for', dateStr)

      // Accumulate QR staff (id → name) from this day's schedule so 指名
      // (nominated_staff_id) can resolve to a name without a roster call.
      for (const r of reservations) qrStaffNameById.set(r.Staff.id, r.Staff.name)

      // Existing appointments for this JST day, keyed by staff + start instant so
      // re-runs update rather than duplicate. Normalize the timestamp to epoch ms
      // so ISO formatting differences between QR and synqed don't break matching.
      const dayStartIso = new Date(`${dateStr}T00:00:00+09:00`).toISOString()
      const dayEndIso = new Date(`${dateStr}T23:59:59+09:00`).toISOString()
      const { appointments: dayAppts } = await synqed.appointments.list({
        from: dayStartIso,
        to: dayEndIso,
        page_size: 200,
      })
      const existingByKey = new Map<string, string>()
      for (const a of dayAppts) existingByKey.set(apptKey(a.staff_id, a.starts_at), a.id)

      for (const qrRes of reservations) {
        if (qrRes.deleted) { skipped++; continue }

        const mapped = mapReservation(qrRes)

        // Match staff by name (fuzzy)
        let staffId: string | null = null
        for (const [name, id] of staffByName) {
          if (name.includes(mapped.staffName) || mapped.staffName.includes(name)) {
            staffId = id
            break
          }
        }

        if (!staffId) {
          console.log(`[QR Sync] No staff match for: ${mapped.staffName}`)
          skipped++
          continue
        }

        // Find or create customer by name, carrying QR's returning-customer
        // signal + lifetime visit count.
        let customerId = customerByName.get(mapped.customerName)
        if (!customerId) {
          const cust = await synqed.customers.create({
            name: mapped.customerName,
            furigana: mapped.customerKana || null,
            phone: mapped.customerPhone || null,
            email: mapped.customerEmail || null,
            notes: mapped.customerNotes || null,
            is_existing_customer: mapped.isExistingCustomer,
            visit_count: mapped.customerVisits ?? 0,
            // 指名: resolve the QR nominated staff → synqed staff → profile id.
            // Skipped (null) when there's no nomination or no linked profile.
            assigned_staff_id: resolveNominatedProfileId(mapped.nominatedStaffQrId),
          })
          customerId = cust.id
          customerByName.set(mapped.customerName, customerId)
        } else if (!refreshedCustomerIds.has(customerId)) {
          // Returning customer already in synqed — refresh the visit count +
          // status (QR's visits_number_cache grows over time). Once per run.
          refreshedCustomerIds.add(customerId)
          await synqed.customers.update(customerId, {
            is_existing_customer: mapped.isExistingCustomer,
            visit_count: mapped.customerVisits ?? 0,
          })
        }

        const notes = `QR #${mapped.qrId} | ${mapped.customerNotes?.slice(0, 100) ?? ''}`
        const key = apptKey(staffId, mapped.startTime)
        const existingId = existingByKey.get(key)

        if (existingId) {
          await synqed.appointments.update(existingId, {
            title: mapped.treatmentName,
            notes,
            duration_minutes: mapped.durationMinutes,
          })
          updated++
          continue
        }

        try {
          const appt = await synqed.appointments.create({
            customer_id: customerId,
            staff_id: staffId,
            starts_at: mapped.startTime,
            ends_at: mapped.endTime,
            duration_minutes: mapped.durationMinutes,
            title: mapped.treatmentName,
            notes,
          })
          existingByKey.set(key, appt.id)
          created++
        } catch (err) {
          // synqed-core rejects a booking that overlaps an existing slot with a
          // 409. Without this guard a single overlap (e.g. two QR therapists the
          // fuzzy matcher collapsed onto one synqed staff) aborts the entire
          // sync after it already wrote the earlier bookings — so the run looks
          // like it fails differently on each retry. Skip the overlap, keep going.
          if (err instanceof SynqedError && err.status === 409) {
            console.warn(`[QR Sync] Slot overlap, skipping QR #${mapped.qrId}`)
            overlapped++
            continue
          }
          throw err
        }
      }
    }

    // Update sync status (Supabase config row)
    await supabase
      .from('sync_config')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'success',
        last_sync_error: null,
      })
      .eq('id', config.id)

    return NextResponse.json({
      success: true,
      from: dates[0],
      to: dates[dates.length - 1],
      total,
      created,
      updated,
      skipped,
      overlapped,
    })
  } catch (error) {
    console.error('[QR Sync]', error)

    await supabase
      .from('sync_config')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'error',
        last_sync_error: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('provider', 'quickreserve')

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
