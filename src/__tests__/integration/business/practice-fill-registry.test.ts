// FILL 2 (S86) R3 — the Business pins of the test-world loader, read by node:fs (the territory never imports scripts/):
// every store the loader manages is a practice twin of its type, generated slots carry that type's own recipe prices,
// and the board pin is the loader's 13:24. Before the loader's FILL 2 lands (registry.json without a `stores` map) the
// registry pins SKIP and say so; after it they are strict.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { boardNow } from '@/business/lib/fixtures-today'
import { SAMPLE_SLOT_PRICES, STORE_SAMPLE_POLICY } from '@/business/lib/practice-door/registry'

const file = join(process.cwd(), 'scripts/test-world/registry.json')
const registry = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { stores?: Record<string, { type: string }> }) : null
// main before FILL 2 has a `stores` map of bare type strings; FILL 2's entries are objects ({ type, keyPrefix, namePool })
const raw = registry?.stores as Record<string, unknown> | undefined
const stores = raw && Object.values(raw).every((e) => typeof e === 'object' && e !== null && 'keyPrefix' in e) ? (raw as Record<string, { type: string }>) : undefined
if (!stores) console.log('practice-fill-registry: scripts/test-world/registry.json has no FILL 2 `stores` map yet (loader FILL 2 not merged) — registry pins skipped')
const strict = stores ? it : it.skip

it('the board pin is the loader\'s 13:24 (plan.ts boardMinute default)', () => {
  expect(boardNow).toBe(13 * 60 + 24)
})

strict('registry.json stores == STORE_SAMPLE_POLICY keys, each a twin of its own type', () => {
  expect(Object.keys(stores!).sort()).toEqual(Object.keys(STORE_SAMPLE_POLICY).sort())
  for (const [id, e] of Object.entries(stores!)) expect(STORE_SAMPLE_POLICY[id]).toMatchObject({ kind: 'twin', type: e.type })
})

strict('R16: every generated slot price is a menu price of that type\'s own recipe', () => {
  for (const [type, p] of Object.entries(SAMPLE_SLOT_PRICES)) {
    const src = readFileSync(join(process.cwd(), `scripts/test-world/recipes/${type}.ts`), 'utf8')
    for (const price of [p!.price_low, p!.price_high]) expect({ type, price, found: src.includes(`price: ${price},`) }).toEqual({ type, price, found: true })
  }
})
