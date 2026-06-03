import { NextRequest, NextResponse } from 'next/server'
import { SynqedClient } from '@synqed-kk/client'
import { createServiceClient } from '@/lib/supabase/service'
import { getBusinessId } from '@/lib/staff'
import {
  qrLogin,
  mapVisit,
  mapDeepCustomer,
  qrGetCustomersServerSide,
  qrGetCustomerReservationsByCustomerId,
} from '@/lib/quickreserve'

export const maxDuration = 300

/**
 * Deep customer crawl: enumerate QR customers, and for each pull the full
 * reservation history (nested Customer profile + Bill/BillItems) and upsert
 * extended profile/summary fields + one customer_visits row per reservation
 * into synqed-core (the source of truth the app reads from).
 *
 * Heavy N+1 crawl against live QR — run sequentially, not the daily reservation
 * sync. `sync_config` (credentials) stays in Supabase; everything the app
 * renders goes through synqed-core.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ?limit=N caps how many customers are processed — use it for a scoped first
  // run before crawling the full roster. 0 / absent = all.
  const limit = Number(request.nextUrl.searchParams.get('limit')) || 0

  const supabase = createServiceClient()

  try {
    const { data: config } = await supabase
      .from('sync_config')
      .select('*')
      .eq('provider', 'quickreserve')
      .single()

    if (!config) {
      return NextResponse.json({
        message: 'QR sync not configured — save your Quick Reserve login first',
      })
    }

    // synqed-core is business-scoped. Use the config row's business id, falling
    // back to the signed-in owner's business for a manual run.
    const businessId = config.business_id || (await getBusinessId())
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

    const session = await qrLogin(config.username, config.password_encrypted)

    const storeSlug = config.base_url || 'la-estro'
    const storeId = config.store_id || 222

    // synqed customer name → id, for find-or-create. (synqed list caps at 200;
    // a QR customer whose name isn't in this window gets created — logged below.)
    const { customers: existingCustomers } = await synqed.customers.list({ page_size: 200 })
    const customerByName = new Map<string, string>()
    for (const c of existingCustomers) {
      if (c.name) customerByName.set(c.name, c.id)
    }

    const pageSize = 100
    let processed = 0
    let created = 0
    let visitsUpserted = 0
    let errors = 0
    let total = 0

    // QR pages are 0-indexed; response is { count, rows }.
    for (let page = 0; page < 100; page++) {
      let rows: Awaited<ReturnType<typeof qrGetCustomersServerSide>>['rows']
      try {
        const result = await qrGetCustomersServerSide(session, storeSlug, storeId, page, pageSize)
        total = result.count
        rows = result.rows
      } catch (err) {
        console.error(`[QR Deep] customers page ${page} fetch error:`, err)
        errors++
        break
      }

      console.log('[QR Deep]', { page, rows: rows.length, total })
      if (rows.length === 0) break

      for (const qrCustomer of rows) {
        if (limit && processed >= limit) break
        const qrCustomerId = qrCustomer.id
        const name: string = qrCustomer.name
        try {
          const reservations = await qrGetCustomerReservationsByCustomerId(
            session, storeSlug, storeId, qrCustomerId,
          )

          const visits = reservations.map(mapVisit)
          const settled = visits.filter((v) => v.status === 'settled')
          const totalSales = settled.reduce((s, v) => s + v.sales_amount, 0)
          const firstVisitAt = visits.length ? visits.map((v) => v.used_at).sort()[0] : null

          // Resolve / create the synqed customer.
          let customerId = customerByName.get(name)
          if (!customerId) {
            console.log(`[QR Deep] Creating synqed customer for QR #${qrCustomerId}: ${name}`)
            const cust = await synqed.customers.create({ name })
            customerId = cust.id
            customerByName.set(name, customerId)
            created++
          }

          // The list row IS the full Customer object — map the profile straight from it.
          await synqed.customers.update(customerId, {
            ...mapDeepCustomer(qrCustomer),
            total_sales: totalSales,
            first_visit_at: firstVisitAt,
          })

          if (visits.length) {
            await synqed.customers.upsertVisits(customerId, visits)
            visitsUpserted += visits.length
          }

          processed++
        } catch (err) {
          console.error(`[QR Deep] Customer #${qrCustomerId} (${name}) error:`, err)
          errors++
          continue
        }
      }

      if (limit && processed >= limit) { console.log(`[QR Deep] limit ${limit} reached`); break }
      if ((page + 1) * pageSize >= total) break
    }

    const tally = { processed, created, visitsUpserted, errors }
    console.log('[QR Deep] Done', tally)
    return NextResponse.json({ success: true, ...tally })
  } catch (error) {
    console.error('[QR Deep]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Deep crawl failed' },
      { status: 500 },
    )
  }
}
