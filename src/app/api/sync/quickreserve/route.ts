import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { qrLogin, qrGetReservations, mapReservation } from '@/lib/quickreserve'

export const maxDuration = 300

/**
 * Sync bookings from Quick Reserve into our appointments table.
 * Called by Vercel cron (daily) or manually.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const syncResult = await runSync()

  // Also run cleanup on cron
  try {
    const cleanupRes = await fetch(new URL('/api/cleanup', request.url))
    console.log('[Cron] Cleanup:', await cleanupRes.json())
  } catch {}

  return syncResult
}

export async function POST() {
  return runSync()
}

async function runSync() {
  const supabase = createServiceClient()

  try {
    const { data: config } = await supabase
      .from('sync_config')
      .select('*')
      .eq('provider', 'quickreserve')
      .eq('enabled', true)
      .single()

    if (!config) {
      return NextResponse.json({ message: 'QR sync not configured or disabled' })
    }

    // Login
    const session = await qrLogin(config.username, config.password_encrypted)

    // Today in JST
    const now = new Date()
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
    const dateStr = jst.toISOString().split('T')[0]

    // Fetch reservations
    const storeSlug = config.base_url || 'la-estro'
    const storeId = config.store_id || 222

    let reservations
    try {
      reservations = await qrGetReservations(session, storeSlug, storeId, dateStr)
    } catch (err) {
      console.error('[QR Sync] Reservation fetch error:', err)
      throw err
    }

    console.log('[QR Sync] Got', reservations.length, 'reservations for', dateStr)

    // Get staff for name matching (scoped to tenant if set)
    const staffQuery = supabase
      .from('profiles')
      .select('id, full_name')
      .not('full_name', 'is', null)

    if (config.tenant_id) {
      staffQuery.eq('customer_id', config.tenant_id)
    }

    const { data: ourStaff } = await staffQuery

    // Build QR staff name → our profile ID map
    const staffNameMap = new Map<string, string>()
    for (const s of (ourStaff ?? [])) {
      if (s.full_name) staffNameMap.set(s.full_name, s.id)
    }

    let created = 0
    let updated = 0
    let skipped = 0

    for (const qrRes of reservations) {
      if (qrRes.deleted) { skipped++; continue }

      const mapped = mapReservation(qrRes)

      // Match staff by name (fuzzy)
      let staffProfileId: string | null = null
      for (const [name, id] of staffNameMap) {
        if (name.includes(mapped.staffName) || mapped.staffName.includes(name)) {
          staffProfileId = id
          break
        }
      }

      if (!staffProfileId) {
        console.log(`[QR Sync] No staff match for: ${mapped.staffName}`)
        skipped++
        continue
      }

      // Find or create customer by name
      const customerQuery = supabase
        .from('customers')
        .select('id')
        .eq('name', mapped.customerName)
        .limit(1)

      if (config.tenant_id) {
        customerQuery.eq('tenant_id', config.tenant_id)
      }

      let { data: customer } = await customerQuery.single()

      if (!customer) {
        const { data: newCust, error: insertErr } = await supabase
          .from('customers')
          .insert({
            id: crypto.randomUUID(),
            tenant_id: config.tenant_id,
            name: mapped.customerName,
            furigana: mapped.customerKana || null,
            phone: mapped.customerPhone || null,
            notes: mapped.customerNotes || null,
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single()
        if (insertErr) console.log('[QR Sync] Customer insert error:', insertErr.message)
        customer = newCust
      }

      if (!customer) { skipped++; continue }

      // Check if appointment already exists (same staff + start time)
      const { data: existing } = await supabase
        .from('appointments')
        .select('id')
        .eq('staff_profile_id', staffProfileId)
        .eq('start_time', mapped.startTime)
        .limit(1)

      if (existing && existing.length > 0) {
        await supabase
          .from('appointments')
          .update({
            title: mapped.treatmentName,
            notes: `QR #${mapped.qrId} | ${mapped.customerNotes?.slice(0, 100) ?? ''}`,
            duration_minutes: mapped.durationMinutes,
          })
          .eq('id', existing[0].id)
        updated++
        continue
      }

      // Create new appointment
      await supabase
        .from('appointments')
        .insert({
          staff_profile_id: staffProfileId,
          client_id: customer.id,
          start_time: mapped.startTime,
          duration_minutes: mapped.durationMinutes,
          title: mapped.treatmentName,
          notes: `QR #${mapped.qrId} | ${mapped.customerNotes?.slice(0, 100) ?? ''}`,
        })

      created++
    }

    // Update sync status
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
      date: dateStr,
      total: reservations.length,
      created,
      updated,
      skipped,
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
