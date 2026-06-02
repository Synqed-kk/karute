/**
 * Runnable QuickReserve deep crawl (same logic as the /api/sync/quickreserve-deep
 * route, as a CLI so it can be run + watched directly). READS QR, WRITES synqed-core.
 *
 *   npx tsx --env-file=.env scripts/qr-deep-crawl.ts        # default: 5 customers (safe first run)
 *   npx tsx --env-file=.env scripts/qr-deep-crawl.ts 50     # 50 customers
 *   npx tsx --env-file=.env scripts/qr-deep-crawl.ts all    # full roster (~1871)
 *
 * Crawled data lands in synqed-core: `customers` (profile+summary cols) +
 * `customer_visits` (one row per QR reservation). Idempotent on qr_reservation_id.
 */
import { createClient } from '@supabase/supabase-js'
import { SynqedClient } from '@synqed-kk/client'
import {
  qrLogin,
  mapVisit,
  mapDeepCustomer,
  qrGetCustomersServerSide,
  qrGetCustomerReservationsByCustomerId,
} from '../src/lib/quickreserve'

async function main() {
  const arg = process.argv[2] ?? '5'
  const limit = arg === 'all' ? 0 : Number(arg) || 5

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: config } = await sb.from('sync_config').select('*').eq('provider', 'quickreserve').single()
  if (!config) throw new Error('No sync_config row for quickreserve')

  const businessId = config.business_id
  if (!businessId) throw new Error('sync_config.business_id is required to run the crawl as a script')

  const synqed = new SynqedClient({
    baseUrl: process.env.SYNQED_CORE_URL!,
    apiKey: process.env.SYNQED_CORE_API_KEY!,
    businessId,
  })

  const session = await qrLogin(config.username, config.password_encrypted)
  const storeSlug = config.base_url || 'la-estro'
  const storeId = config.store_id || 222

  const { customers: existing } = await synqed.customers.list({ page_size: 200 })
  const customerByName = new Map<string, string>()
  for (const c of existing) if (c.name) customerByName.set(c.name, c.id)

  const pageSize = 100
  let processed = 0, created = 0, visitsUpserted = 0, errors = 0, total = 0
  console.log(`[crawl] limit=${limit || 'ALL'}`)

  for (let page = 0; page < 100; page++) {
    const { count, rows } = await qrGetCustomersServerSide(session, storeSlug, storeId, page, pageSize)
    total = count
    console.log(`[crawl] page ${page}: ${rows.length} rows (total ${total})`)
    if (rows.length === 0) break

    for (const row of rows) {
      if (limit && processed >= limit) break
      try {
        const reservations = await qrGetCustomerReservationsByCustomerId(session, storeSlug, storeId, row.id)
        const visits = reservations.map(mapVisit)
        const settled = visits.filter((v) => v.status === 'settled')
        const totalSales = settled.reduce((s, v) => s + v.sales_amount, 0)
        const firstVisitAt = visits.length ? visits.map((v) => v.used_at).sort()[0] : null

        let customerId = customerByName.get(row.name)
        if (!customerId) {
          const cust = await synqed.customers.create({ name: row.name })
          customerId = cust.id
          customerByName.set(row.name, customerId)
          created++
        }
        await synqed.customers.update(customerId, {
          ...mapDeepCustomer(row),
          total_sales: totalSales,
          first_visit_at: firstVisitAt,
        })
        if (visits.length) {
          await synqed.customers.upsertVisits(customerId, visits)
          visitsUpserted += visits.length
        }
        processed++
        if (processed % 25 === 0) console.log(`[crawl] processed ${processed}…`)
      } catch (err) {
        errors++
        console.error(`[crawl] customer #${row.id} (${row.name}) error:`, err instanceof Error ? err.message : err)
      }
    }
    if (limit && processed >= limit) break
    if ((page + 1) * pageSize >= total) break
  }

  console.log('[crawl] DONE', { processed, created, visitsUpserted, errors, totalInQr: total })
}
main().catch((e) => { console.error(e); process.exit(1) })
