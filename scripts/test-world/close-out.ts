// close-out.ts — D7: fill.ts only ADDS rows, so a booking it made as SCHEDULED stays 予約済み after its day; plan()
// already knows each key's status, and this script writes it onto those rows. Karutes and 回数券 burns for the newly
// COMPLETED ones ride the NEXT `fill.ts apply` (it writes them for COMPLETED bookings only) — not built here.
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/close-out.ts <store-id> --manifest <path> [--apply]
// DRY-RUN IS THE DEFAULT: every read, no write. Liam's word before a live --apply.
// Scope: fill-tagged ([tw:…], fill.ts's regex) · this store · SCHEDULED · started before now · owned (its customer = the
// live customer of the plan's member number, fill.ts's rule; else one skipped line). New status = plan()'s for the key
// (not in the plan, or still SCHEDULED there → one skipped line). The write = status + acting_staff_id + status_reason
// only: no delete, no new row, notes untouched. Pin (fill.ts's): the hard Dev Salon id + assertDevSalon before any
// booking is read; the store in registry.json; the manifest (epoch + hours) read, never written.
// Env: SYNQED_CORE_URL, SYNQED_CORE_API_KEY (values are never printed). Exit: 0 ok · 1 error, REFUSED or a failed write.
import { existsSync, readFileSync } from 'node:fs'
import { assertDevSalon, DEV_SALON_BUSINESS_ID, pageAll } from './count-baseline'
import { jstToday, loadRecipe, registry, type FillCore, type Manifest } from './fill'
import { addDays, jstIso, plan } from './plan'

export async function closeOut(core: Pick<FillCore, 'orgSettings' | 'staff' | 'customers' | 'appointments'>, storeId: string, m: Manifest, now: Date, apply: boolean, log: (l: string) => void): Promise<number> {
  await assertDevSalon(core) // a Refused throws: exit 1 before any booking is read
  const [type, st, today] = [registry.stores[storeId], m.stores[storeId], jstToday(now)]
  if (!type || !st) throw new Error(`store ${storeId} is not in registry.json or not in the manifest`)
  const p = plan(await loadRecipe(type), { storeId, weeklyHours: st.weeklyHours }, today, st.epoch)
  const planned = new Map(p.appointments.map((a) => [a.key, a]))
  const all = await pageAll('customers', (page) => core.customers.list({ include_deleted: true, page, page_size: 500 }))
  const custId = new Map(all.filter((c) => c.member_number && !(c as { deleted_at?: string | null }).deleted_at).map((c) => [c.member_number!, c.id]))
  const window = await pageAll('appointments', (page) => core.appointments.list({ from: jstIso(p.window.from, 0), to: jstIso(addDays(p.window.to, 1), 0), page, page_size: 500 }))
  const counts: Record<string, [planned: number, written: number]> = { COMPLETED: [0, 0], CANCELLED: [0, 0], NO_SHOW: [0, 0] }
  const skipped: string[] = []
  let failed = 0
  // fill.ts's rule for "ours": the manifest's recorded id wins over a tag; with no recorded id, a tag on 2+ bookings is ambiguous
  const tagOf = (r: { notes: string | null }) => /\[(tw:[^\]]+)\]/.exec(r.notes ?? '')?.[1]
  const seen = new Map<string, number>()
  for (const t of window.map(tagOf)) if (t) seen.set(t, (seen.get(t) ?? 0) + 1)
  for (const r of window) {
    const tag = tagOf(r)
    if (!tag || r.store_id !== storeId || r.status !== 'SCHEDULED' || Date.parse(r.starts_at) >= now.getTime()) continue
    const rec = st.created?.appointments?.[tag]
    if (rec ? rec !== r.id : seen.get(tag)! > 1) { skipped.push(`appointments ${tag}: booking ${r.id} ${rec ? 'is not the booking the manifest records for this key' : `carries a tag seen on ${seen.get(tag)} bookings`}, left alone`); continue }
    const a = planned.get(tag)
    if (!a || a.status === 'SCHEDULED') { skipped.push(`appointments ${tag}: booking ${r.id} is ${a ? 'still SCHEDULED in the plan' : 'not in the plan'}, left alone`); continue }
    if (r.customer_id !== custId.get(a.member)) { skipped.push(`appointments ${tag}: booking ${r.id}'s customer differs from the planned customer, left alone`); continue }
    counts[a.status][0]++
    if (!apply) continue
    try {
      await core.appointments.update(r.id, { status: a.status, acting_staff_id: r.staff_id, status_reason: 'テストデータ close-out' })
      counts[a.status][1]++
    } catch (e) {
      failed++
      log(`FAILED: appointments ${tag}: booking ${r.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  log(`mode: ${apply ? 'apply' : 'dry-run'} · today ${today}`)
  for (const [s, [n, w]] of Object.entries(counts)) log(`${s}: planned ${n} · written ${w}`)
  skipped.forEach((l) => log(`skipped: ${l}`))
  return failed ? 1 : 0
}

// ── CLI (lazy client import, so the test loads this file under CommonJS ts-node) ───────────────
if (process.argv[1]?.endsWith('close-out.ts')) {
  const [store, ...rest] = process.argv.slice(2)
  const path = rest.includes('--manifest') ? rest[rest.indexOf('--manifest') + 1] : undefined
  const main = async (): Promise<number> => {
    if (!store || store.startsWith('--') || !path || !existsSync(path)) return (console.log('usage: close-out.ts <store-id> --manifest <path> [--apply]'), 1)
    const { SYNQED_CORE_URL: baseUrl, SYNQED_CORE_API_KEY: apiKey } = process.env
    if (!baseUrl || !apiKey) throw new Error('set SYNQED_CORE_URL and SYNQED_CORE_API_KEY first (values are never printed)')
    const m: Manifest = JSON.parse(readFileSync(path, 'utf8'))
    if (m.businessId !== DEV_SALON_BUSINESS_ID) throw new Error('the manifest is not a Dev Salon manifest')
    const { SynqedClient } = await import('@synqed-kk/client')
    return closeOut(new SynqedClient({ baseUrl, apiKey, businessId: DEV_SALON_BUSINESS_ID }), store, m, new Date(), rest.includes('--apply'), console.log)
  }
  main().then((code) => process.exit(code), (e) => (console.error('close-out failed:', e instanceof Error ? e.message : String(e)), process.exit(1)))
}
