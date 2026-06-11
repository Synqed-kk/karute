// P4 import, step 0 (READ-ONLY): dump the live customer list (id+name) for the
// dry-run matcher. Tenant = the business with the most customers (the real
// salon; test tenants have <20) — printed loudly, verified in the dry run.
// Run: node --env-file=.env scripts/import/dump-customers.mjs
import { SynqedClient } from '@synqed-kk/client'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)
const { data: profs } = await sb
  .from('profiles')
  .select('customer_id, full_name')
  .not('customer_id', 'is', null)
const candidates = [...new Map(profs.map((p) => [p.customer_id, p])).entries()]
let best = null
for (const [bid, p] of candidates) {
  const synqed = new SynqedClient({
    baseUrl: process.env.SYNQED_CORE_URL,
    apiKey: process.env.SYNQED_CORE_API_KEY,
    businessId: bid,
  })
  try {
    const { total } = await synqed.customers.list({ page: 1, page_size: 1 })
    if (!best || total > best.total) best = { bid, total, name: p.full_name }
  } catch {}
}
console.log('tenant:', best.name, best.bid, '— customers:', best.total)

const synqed = new SynqedClient({
  baseUrl: process.env.SYNQED_CORE_URL,
  apiKey: process.env.SYNQED_CORE_API_KEY,
  businessId: best.bid,
})
const all = []
for (let page = 1; page <= 10; page++) {
  const { customers } = await synqed.customers.list({ page, page_size: 200 })
  all.push(
    ...customers.map((c) => ({
      id: c.id,
      name: c.name,
      visit_count: c.visit_count ?? null,
      has_ticket_pack: c.has_ticket_pack ?? null,
    })),
  )
  if (customers.length < 200) break
}
writeFileSync(
  '/tmp/karute-customers.json',
  JSON.stringify({ businessId: best.bid, tenant: best.name, customers: all }, null, 1),
)
console.log('dumped', all.length, 'customers')
