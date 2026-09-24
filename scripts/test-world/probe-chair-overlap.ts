// probe-chair-overlap.ts — ONE-OFF PROBE for the ヘアサロン test store (not part of the fill): may ONE stylist hold two overlapping
// bookings on two chairs (a colour processing on one while she blow-dries a guest on the other)? A chair claim is exclusive (409
// RESOURCE_TAKEN); whether core refuses one staff member twice is open (DATA-MAP §3). The lead runs it once the store is filled.
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/probe-chair-overlap.ts --store <id>
// A = HS-0001, chair 1, 11:00–12:30 リタッチカラー, then B = HS-0002, chair 2, 11:30–12:00 シャンプー＆ブロー, SAME stylist (the recipe's
// first STYLIST), on the first open day from tomorrow when the stylist and both chairs are free 11:00–13:00 (else A clashes with a
// fill booking and proves nothing). A 409 on B is the finding. Both rows stay; nothing is deleted. Same pin as fill.ts.
// Env: SYNQED_CORE_URL, SYNQED_CORE_API_KEY (never printed). Exit: 0 ok, a 409 included · 1 other error · 2 REFUSED.
import { isTerminalStatus } from '../../src/lib/appointments/status'
import { assertDevSalon, DEV_SALON_BUSINESS_ID, pageAll, Refused } from './count-baseline'
import { jstToday, loadRecipe, registry } from './fill'
import { addDays, hoursOn, jstIso } from './plan'

const store = process.argv.includes('--store') ? process.argv[process.argv.indexOf('--store') + 1] : undefined
const statusOf = (e: unknown) => (e as { status?: number } | null)?.status
const need = <T,>(x: T | undefined, what: string): T => x ?? (() => { throw new Error(`${what} not found (run the fill first)`) })()

async function main(): Promise<number> {
  if (!store) return (console.log('usage: probe-chair-overlap.ts --store <hair salon store id>'), 1)
  if (registry.stores[store] !== 'hair_salon') throw new Error(`store ${store} is not mapped to hair_salon in registry.json`)
  const { SYNQED_CORE_URL: baseUrl, SYNQED_CORE_API_KEY: apiKey } = process.env
  if (!baseUrl || !apiKey) throw new Error('set SYNQED_CORE_URL and SYNQED_CORE_API_KEY first (values are never printed)')
  const { SynqedClient } = await import('@synqed-kk/client')
  const core = new SynqedClient({ baseUrl, apiKey, businessId: DEV_SALON_BUSINESS_ID })
  const cards = await assertDevSalon(core).catch((e: unknown) => { if (e instanceof Refused) return e; throw e })
  if (cards instanceof Refused) return (console.log(`REFUSED: ${cards.message}`), 2)
  const r = await loadRecipe('hair_salon')
  const stylist = need(cards.find((c) => c.name === r.staff.find((s) => s.role === 'STYLIST')!.name), 'the first stylist card')
  const { resources } = await core.resources.list({ store_id: store })
  const [c1, c2] = r.resources.slice(0, 2).map((x) => need(resources.find((y) => y.name === x.name), x.name).id)
  const menus = (await core.menus.list()).menus.filter((m) => m.store_id === store)
  const customers = await pageAll('customers', (page) => core.customers.list({ page, page_size: 500 }))
  const days = Array.from({ length: 60 }, (_, i) => addDays(jstToday(), i + 1))
  const booked = await pageAll('appointments', (page) => core.appointments.list({ store_id: store, from: jstIso(days[0], 0), to: jstIso(days[59], 1440), page, page_size: 500 }))
  const holds = (x: (typeof booked)[number], d: string) => !isTerminalStatus(x.status) && Date.parse(x.starts_at) < Date.parse(jstIso(d, 780)) && Date.parse(jstIso(d, 660)) < Date.parse(x.occupied_until ?? x.ends_at)
  const day = need(days.find((d) => hoursOn(r.policy.weekly_hours, d) && !booked.some((x) => holds(x, d) && (x.staff_id === stylist.id || x.resource_id === c1 || x.resource_id === c2))), 'a clear open day in the next 60 days')
  console.log(`probe day ${day} · stylist ${stylist.name} · chairs ${r.resources[0].name} / ${r.resources[1].name}`)
  let madeA = false
  for (const [k, member, chair, menuName, from, to] of [['A', 'HS-0001', c1, 'リタッチカラー', 660, 750], ['B', 'HS-0002', c2, 'シャンプー＆ブロー', 690, 720]] as const) {
    if (k === 'B' && !madeA) return (console.log('B status skipped id - message A was not created: the probe proves nothing'), 0)
    const menu = need(menus.find((m) => m.name === menuName), menuName)
    const customer = need(customers.find((c) => c.member_number === member), member)
    try {
      const row = await core.appointments.create({
        customer_id: customer.id, staff_id: stylist.id, store_id: store, menu_id: menu.id, resource_id: chair, starts_at: jstIso(day, from), ends_at: jstIso(day, to), duration_minutes: to - from,
        booked_price_amount: menu.price_list_amount, booked_price_currency: 'JPY', status: 'SCHEDULED', source: 'MANUAL', title: null, notes: `テストデータ [tw:probe:hair_salon:${k}]`,
      }, { idempotencyKey: `test-world:probe:${k}` })
      madeA ||= k === 'A'
      console.log(`${k} status created id ${row.id} message -`)
    } catch (e) {
      console.log(`${k} status ${statusOf(e) ?? 'error'} id - message ${e instanceof Error ? e.message : String(e)}`)
      if (statusOf(e) !== 409) return 1
    }
  }
  return 0
}

main().then((code) => process.exit(code), (e) => (console.error('probe failed:', e instanceof Error ? e.message : String(e)), process.exit(1)))
