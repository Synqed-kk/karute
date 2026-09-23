// Runnable check (no framework, no network): `npx tsx scripts/test-world/count-baseline.test.ts`.
// A fake core object stands in for SynqedClient; it caps pages at 2 rows so paging is exercised.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { count, run, DEV_SALON_BUSINESS_ID, type Core } from './count-baseline'

const A = 'store-a'
const B = 'store-b'
const PAST = '2020-01-01T00:00:00Z'
const FUTURE = '2099-01-01T00:00:00Z'
type Q = { store_id?: string; include_deleted?: boolean; page?: number; page_size?: number }

// Like core: honours page/page_size, echoes the page_size it used (here capped at 2).
const paged = (key: string, rows: unknown[]) => async ({ page = 1, page_size = 20 }: Q = {}) => {
  const size = Math.min(page_size, 2)
  return { [key]: rows.slice((page - 1) * size, page * size), page, page_size: size, total: rows.length }
}

function fakeCore(o: { business?: string; devEmail?: string; customers?: number; packs?: number; softDeleted?: number } = {}): Core {
  const customers = Array.from({ length: o.customers ?? 5 }, (_, i) => ({ id: `c${i}` }))
  // Like core: soft-deleted customers come back only with include_deleted.
  const binned = Array.from({ length: o.softDeleted ?? 0 }, (_, i) => ({ id: `d${i}`, deleted_at: PAST }))
  const appointments = [
    { store_id: A, starts_at: PAST }, { store_id: A, starts_at: FUTURE }, { store_id: B, starts_at: PAST }, { store_id: null, starts_at: FUTURE },
  ]
  return {
    orgSettings: { get: async () => ({ business_id: o.business ?? DEV_SALON_BUSINESS_ID }) },
    stores: { list: async () => ({ stores: [{ id: A, name: 'テスト東京店' }, { id: B, name: 'テスト横浜店' }] }) },
    staff: { list: paged('staff', [{ email: o.devEmail ?? 'Dev@karute.test' }, { email: null }, { email: 'x@example.test' }]) },
    staffStores: { counts: async () => ({ counts: { [A]: 2 } }) },
    menus: { list: async () => ({ menus: [{ store_id: A }, { store_id: null }] }) },
    resources: { list: async (q: Q) => ({ resources: q.store_id === A ? [{}, {}] : [] }) },
    customers: { list: async (q: Q) => paged('customers', q.store_id === B ? [] : q.include_deleted ? [...customers, ...binned] : customers)(q) },
    appointments: { list: paged('appointments', appointments) },
    karuteRecords: { list: paged('karute_records', [{ store_id: A }]) },
    recordings: { list: paged('recordings', []) },
    packs: { listActivePacks: async () => Array.from({ length: o.packs ?? 1 }, () => ({})) },
  } as unknown as Core
}

async function main() {
  // 1. count: every kind, paged past page 1 (staff 3 rows, customers 5 rows at 2 per page).
  const c = await count(fakeCore())
  assert.deepEqual(c.business, {
    name: 'business', stores: 2, staff: 3, menus: 2, customers: 5, packs_active: 1,
    appointments: 4, appointments_past: 2, karute_records: 1, recordings: 0,
  })
  assert.deepEqual(c[A], { name: 'テスト東京店', staff: 2, menus: 1, resources: 2, customers: 5, appointments: 2, appointments_past: 1, karute_records: 1, recordings: 0 })
  assert.deepEqual(c[B], { name: 'テスト横浜店', staff: 0, menus: 0, resources: 0, customers: 0, appointments: 1, appointments_past: 1, karute_records: 0, recordings: 0 })

  // 1b. soft-deleted customers still count (business-wide and per store): not a loss.
  const withBin = await count(fakeCore({ softDeleted: 2 }))
  assert.equal(withBin.business.customers, 7, 'business customers include soft-deleted rows')
  assert.equal(withBin[A].customers, 7, 'store customers include soft-deleted rows')

  // 1c. a response without page_size fails fast instead of looping to the page cap.
  const noPageSize = { ...fakeCore(), staff: { list: async () => ({ staff: [] }) } } as unknown as Core
  await assert.rejects(count(noPageSize), { message: 'staff: response has no page_size' })

  const path = join(mkdtempSync(join(tmpdir(), 'count-baseline-')), 'baseline.json')
  const exec = async (argv: string[], core: Core) => {
    const lines: string[] = []
    return { code: await run(argv, core, (l) => lines.push(l)), lines }
  }
  assert.equal((await exec(['write', path], fakeCore())).code, 0)

  // 2. equal → 0.
  const same = await exec(['check', path], fakeCore())
  assert.equal(same.code, 0)
  assert.ok(same.lines.includes('BASELINE OK: no count fell'))

  // 3. growth → 0 (Liam plays with the world).
  assert.equal((await exec(['check', path], fakeCore({ customers: 7 }))).code, 0)

  // 4. a drop → 3 with the breach line naming store · kind · baseline · now.
  const drop = await exec(['check', path], fakeCore({ customers: 3 }))
  assert.equal(drop.code, 3)
  assert.ok(drop.lines.includes('BASELINE BREACH: テスト東京店 (store-a) · customers · baseline 5 · now 3'), drop.lines.join('\n'))
  assert.ok(drop.lines.includes('BASELINE BREACH: business (business) · customers · baseline 5 · now 3'))

  // 5. packs_active drops → 0, no breach line (volatile kind: a used-up pack is play, not loss).
  const packs = await exec(['check', path], fakeCore({ packs: 0 }))
  assert.equal(packs.code, 0)
  assert.ok(!packs.lines.some((l) => l.startsWith('BASELINE BREACH')), packs.lines.join('\n'))

  // 6. wrong business → 2 REFUSED, and no dev@karute.test card → 2.
  const wrong = await exec(['print'], fakeCore({ business: '00000000-0000-0000-0000-000000000000' }))
  assert.equal(wrong.code, 2)
  assert.match(wrong.lines[0], /^REFUSED: /)
  assert.equal((await exec(['check', path], fakeCore({ devEmail: 'someone@else.test' }))).code, 2)

  // 7. usage: write/check need a path.
  assert.equal((await exec(['check'], fakeCore())).code, 1)

  console.log('✓ count-baseline: all assertions passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
