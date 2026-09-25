// Runnable check (no framework, no network), same command as ci.yml:
//   npx --no -- ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/test-world/close-out.test.ts
// An in-memory core holds what fill.ts left: every planned booking tagged, those from the epoch on still SCHEDULED.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { closeOut } from './close-out'
import { DEV_SALON_BUSINESS_ID } from './count-baseline'
import { loadRecipe, type FillCore, type Manifest } from './fill'
import { addDays, jstIso, plan } from './plan'

const STORE = 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f' // beauty_chiropractic in registry.json
const [EPOCH, TODAY] = ['2026-09-18', '2026-09-26']
const NOW = new Date(jstIso(TODAY, 18 * 60)) // 18:00 JST: today's 17:30 bookings have started, the plan still says SCHEDULED
type Q = { page: number; page_size: number }
const paged = (key: string, xs: unknown[], q: Q) => ({ [key]: xs.slice((q.page - 1) * q.page_size, q.page * q.page_size), page_size: q.page_size })

async function main() {
  const recipe = await loadRecipe('beauty_chiropractic')
  const m: Manifest = { businessId: DEV_SALON_BUSINESS_ID, stores: { [STORE]: { type: recipe.id, epoch: EPOCH, weeklyHours: recipe.policy.weekly_hours, created: {} } }, runs: [] }
  const p = plan(recipe, { storeId: STORE, weeklyHours: recipe.policy.weekly_hours }, TODAY, EPOCH)
  const rows = p.appointments.map((a) => ({
    id: `a-${a.key}`, key: a.key, date: a.date, want: a.status, store_id: STORE, customer_id: `c-${a.member}`, staff_id: `s-${a.staff}`,
    starts_at: a.startsAt, notes: `テストデータ [${a.key}]` as string | null, status: a.date >= EPOCH ? 'SCHEDULED' : a.status,
  }))
  const stale = rows.filter((r) => r.date >= EPOCH && r.date < TODAY) // made SCHEDULED at the epoch, their day now past
  const [future, untagged, done, foreign, ghost, twin, owned] = stale
  future.starts_at = jstIso(addDays(TODAY, 3), 600) // staff moved it on: still SCHEDULED, tagged, the plan says it is over
  untagged.notes = null // staff cleared the note
  done.status = 'CANCELLED' // staff closed it in Business
  foreign.customer_id = 'someone-else'
  const binned = { id: 'binned-cust', member_number: ghost.customer_id.slice(2), deleted_at: '2026-09-20T00:00:00Z' } // in the bin, same member number
  ghost.customer_id = binned.id
  // the manifest records every loader booking's id but twin's; copy and twinCopy copy a tag (same store, customer, day)
  m.stores[STORE].created.appointments = Object.fromEntries(rows.filter((r) => r !== twin).map((r) => [r.key, r.id]))
  const other = { ...owned, id: 'other-store-row', store_id: 'store-other' } // same tag + customer, another store
  const probe = { ...owned, id: 'probe-row', key: 'tw:probe:beauty_chiropractic:2026-09-20:A', notes: 'テストデータ [tw:probe:beauty_chiropractic:2026-09-20:A]' }
  const [copy, twinCopy] = [{ ...owned, id: 'copy-row' }, { ...twin, id: 'twin-row' }]
  rows.push(other, probe, copy, twinCopy)
  const want = stale.slice(6).map((r) => ({ id: r.id, input: { status: r.want, acting_staff_id: r.staff_id, status_reason: 'テストデータ close-out' } }))
  const startedToday = rows.filter((r) => r.date === TODAY && Date.parse(r.starts_at) < NOW.getTime())
  assert.ok(want.length > 5 && want.some((w) => w.input.status !== 'COMPLETED') && startedToday.length > 0, 'the fixture: stale rows of more than one status, a booking started today')

  const fake = (business = DEV_SALON_BUSINESS_ID) => {
    const [calls, reads] = [[] as { id: string; input: unknown }[], { appts: 0 }]
    const core = {
      orgSettings: { get: async () => ({ business_id: business }) },
      staff: { list: async (q: Q) => paged('staff', [{ id: 'dev', email: 'dev@karute.test' }], q) },
      customers: { list: async (q: Q) => paged('customers', [...recipe.customers.map((c) => ({ id: `c-${c.member}`, member_number: c.member })), binned], q) },
      appointments: { list: async (q: Q) => (reads.appts++, paged('appointments', rows, q)), update: async (id: string, input: unknown) => (calls.push({ id, input }), {}) },
    }
    return { core: core as unknown as FillCore, calls, reads }
  }
  const run = async (apply: boolean, f = fake(), lines: string[] = []) => ({ ...f, lines, code: await closeOut(f.core, STORE, m, NOW, apply, (l) => void lines.push(l)) })
  const table = (mode: string, written: boolean) => [`mode: ${mode} · today ${TODAY}`, ...['COMPLETED', 'CANCELLED', 'NO_SHOW'].map((s) => ((n) => `${s}: planned ${n} · written ${written ? n : 0}`)(want.filter((w) => w.input.status === s).length))]
  const head = (lines: string[]) => lines.filter((l) => !l.startsWith('skipped: '))
  const dry = await run(false)
  const ap = await run(true)
  const touched = (id: string) => ap.calls.some((c) => c.id === id)

  assert.ok(!touched(future.id), '(c) a future SCHEDULED tagged row is untouched')
  assert.ok(!touched(untagged.id) && !ap.lines.some((l) => l.includes(untagged.id)), '(d) an untagged past SCHEDULED row is untouched, no line')
  const terminal = rows.filter((r) => r.status !== 'SCHEDULED').map((r) => r.id)
  assert.ok(terminal.length > 10 && !ap.calls.some((c) => terminal.includes(c.id)), '(e) COMPLETED / CANCELLED / NO_SHOW rows are untouched')
  assert.deepEqual(ap.lines.filter((l) => l.includes(foreign.id)), [`skipped: appointments ${foreign.key}: booking ${foreign.id}'s customer differs from the planned customer, left alone`], '(f) a customer-mismatch row is skipped with one line')
  assert.ok(!touched(foreign.id), '(f) a customer-mismatch row is untouched')
  assert.ok(!touched(other.id), '(i) a tagged SCHEDULED past row of another store is untouched')
  const only = (id: string) => [touched(id), ap.lines.filter((l) => l.includes(id))]
  assert.deepEqual(only(ghost.id), [false, [`skipped: appointments ${ghost.key}: booking ${ghost.id}'s customer differs from the planned customer, left alone`]], '(j) a row on a binned customer of the planned member number: a mismatch line, no write')
  assert.deepEqual(only(probe.id), [false, [`skipped: appointments ${probe.key}: booking ${probe.id} is not in the plan, left alone`]], '(k) a tag not in the plan: one skipped line, no write')
  assert.deepEqual([touched(owned.id), ...only(copy.id)], [true, false, [`skipped: appointments ${owned.key}: booking ${copy.id} is not the booking the manifest records for this key, left alone`]], '(l) a copied tag: only the recorded booking is written, the copy skipped with one line')
  const twinLines = [twin.id, twinCopy.id].map((id) => `skipped: appointments ${twin.key}: booking ${id} carries a tag seen on 2 bookings, left alone`)
  assert.deepEqual([touched(twin.id), touched(twinCopy.id), ap.lines.filter((l) => l.includes(twin.key))], [false, false, twinLines], '(m) one tag on two bookings, no recorded id: both skipped with a line, 0 writes')
  const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((x, y) => x.id.localeCompare(y.id))
  assert.deepEqual(byId(ap.calls), byId(want), '(b) apply: exactly the tagged + SCHEDULED + past + owned rows, with plan() status and the exact input')
  assert.deepEqual([ap.code, head(ap.lines)], [0, table('apply', true)], '(b) apply: written = planned per status')
  assert.equal(dry.calls.length, 0, '(a) dry-run: 0 update calls')
  assert.deepEqual([dry.code, head(dry.lines)], [0, table('dry-run', false)], '(a) dry-run: the table with the planned counts')

  const wrong = fake('00000000-0000-0000-0000-000000000000')
  await assert.rejects(closeOut(wrong.core, STORE, m, NOW, true, () => {}), /not the Dev Salon/, '(g) another business: refused (throws)')
  assert.deepEqual([wrong.reads.appts, wrong.calls.length], [0, 0], '(g) another business: no booking read, 0 writes')

  const src = readFileSync(join(__dirname, 'close-out.ts'), 'utf8')
  assert.equal(src.split('.update(').length, 2, '(h) close-out.ts: exactly one .update( call')
  assert.doesNotMatch(src, /\.delete\(|remove\(|destroy\(|\.create\(|\.patch\(/, '(h) close-out.ts: no delete / remove / destroy / create / patch call')
  const guard = /for \(const file of \[([^\]]*)\]/.exec(readFileSync(join(__dirname, 'fill.test.ts'), 'utf8'))![1]
  assert.doesNotMatch(guard, /close-out/, '(h) fill.test.ts: the no-update guard list does not hold close-out.ts')
  console.log('✓ close-out: all assertions passed')
}

main().catch((e) => (console.error(e), process.exit(1)))
