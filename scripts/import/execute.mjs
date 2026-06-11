// P4 IMPORT EXECUTOR — scope C (full sheet replica), Liam-approved.
// Idempotent: re-runs skip customers/packs/lifecycles that already exist.
// Run: node --env-file=.env scripts/import/execute.mjs
import { SynqedClient } from '@synqed-kk/client'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const plan = JSON.parse(readFileSync('/tmp/import-plan.json', 'utf8'))
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const synqed = new SynqedClient({
  baseUrl: process.env.SYNQED_CORE_URL,
  apiKey: process.env.SYNQED_CORE_API_KEY,
  businessId: plan.businessId,
})
const log = { created: 0, createSkipped: 0, packs: 0, packSkipped: 0, redemptions: 0, lifecycles: 0, lcSkipped: 0, errors: [] }

function redemptionDates(consumed, visitDates, lastVisit) {
  // last `consumed` real visit dates; pad weekly back from last_visit if short
  const dates = (visitDates || []).slice(-consumed)
  const anchor = lastVisit || dates[dates.length - 1] || null
  while (dates.length < consumed) {
    const base = anchor ? new Date(anchor) : new Date()
    base.setDate(base.getDate() - 7 * (consumed - dates.length))
    dates.unshift(base.toISOString().slice(0, 10))
  }
  return dates.slice(0, consumed)
}

async function importCustomerData(customerId, row) {
  const pack = row.pack
  if (pack) {
    const { data: existing } = await sb.from('ticket_packs')
      .select('id').eq('customer_id', customerId).eq('source', 'import').limit(1)
    if (existing?.length) { log.packSkipped++ } else {
      const isPack = pack.kind === 'pack'
      const consumed = isPack ? (pack.consumed ?? 0) : 0
      const rDates = isPack ? redemptionDates(consumed, row.visit_dates, row.last_visit) : []
      const { data: p, error } = await sb.from('ticket_packs').insert({
        customer_id: customerId,
        kind: pack.kind,
        pack_size: isPack ? pack.size : 1,
        unit_price: pack.unit_price ?? 0,
        total_price: null,
        purchase_round: pack.round ?? 1,
        purchased_at: rDates[0] ?? row.first_visit ?? row.last_visit ?? null,
        source: 'import',
        notes: isPack ? 'Kitano sheet import' : `Kitano sheet import (${pack.raw})`,
        created_by: null,
      }).select('id').single()
      if (error) { log.errors.push(`pack ${row.sheet_name}: ${error.message}`); return }
      log.packs++
      if (rDates.length) {
        const { error: re } = await sb.from('pack_redemptions').insert(
          rDates.map((d) => ({ pack_id: p.id, customer_id: customerId, redeemed_on: d, source: 'import' })),
        )
        if (re) log.errors.push(`redemptions ${row.sheet_name}: ${re.message}`)
        else log.redemptions += rDates.length
      }
    }
  }
  if (row.lifecycle || row.referral) {
    const { data: lc } = await sb.from('customer_lifecycle')
      .select('customer_id').eq('customer_id', customerId).limit(1)
    if (lc?.length) { log.lcSkipped++ } else {
      const { error } = await sb.from('customer_lifecycle').insert({
        customer_id: customerId,
        status: row.lifecycle ?? 'active',
        referral: !!row.referral,
        status_changed_at: row.lifecycle ? (row.last_visit ? row.last_visit + 'T00:00:00+09:00' : null) : null,
        reason: row.lifecycle ? 'sheet-import' : null,
      })
      if (error) log.errors.push(`lifecycle ${row.sheet_name}: ${error.message}`)
      else log.lifecycles++
    }
  }
}

// Phase 1: matched 136 — data onto existing customers
for (const m of plan.matched) await importCustomerData(m.app_id, m)

// Phase 2: sheet-only 176 — create customer, set QR-ish fields, then data
const { customers: freshList } = await synqed.customers.list({ page: 1, page_size: 500 })
const existingNames = new Set(freshList.map((c) => (c.name || '').replace(/[\s　]/g, '')))
for (const row of plan.sheet_only) {
  const key = row.create_name.replace(/[\s　]/g, '')
  if (existingNames.has(key)) { log.createSkipped++; continue }
  try {
    const customer = await synqed.customers.create({ name: row.create_name })
    log.created++
    try {
      await synqed.customers.update(customer.id, {
        visit_count: row.visit_count ?? undefined,
        is_existing_customer: true,
        has_ticket_pack: !!(row.pack && row.pack.kind === 'pack' && row.pack.remaining > 0),
      })
    } catch (e) { log.errors.push(`update ${row.sheet_name}: ${e.message?.slice(0, 60)}`) }
    await importCustomerData(customer.id, row)
  } catch (e) { log.errors.push(`create ${row.sheet_name}: ${e.message?.slice(0, 60)}`) }
}

console.log(JSON.stringify(log, null, 1))
