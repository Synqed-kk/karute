// legacy-golden.ts — prints __fixtures__/legacy-keys.txt: the three original stores' first thirty members and every row of
// theirs (status · start · staff · resource · menu) at a fixed today = epoch. Pure (no network). ⚖ R5 (S86): legacy members
// keep the origin/main planner's paths; this file was checked equal to the origin/main 7a12cfb3c planner's output.
import { loadRecipe, registry, storeCtx } from './fill'
import { plan } from './plan'

export const GOLDEN_TODAY = '2026-10-07'
async function main() {
  const stores: Record<string, unknown> = {}
  for (const [id, e] of Object.entries(registry.stores)) {
    if (e.keyPrefix !== e.type) continue
    const r = await loadRecipe(e.type, id)
    const legacy = new Set(r.legacyMembers)
    const p = plan(r, storeCtx(id, { weeklyHours: r.policy.weekly_hours, legacyThrough: '9999-12-31' }), GOLDEN_TODAY, GOLDEN_TODAY)
    stores[id] = { customers: r.customers.filter((c) => legacy.has(c.member)),
      rows: p.appointments.filter((a) => legacy.has(a.member)).map((a) => [a.key, a.status, a.startsAt, a.staff, a.resource, a.menu]) }
  }
  console.log('# regenerate: npx --no -- ts-node --transpile-only -O \'{"module":"commonjs","moduleResolution":"node"}\' scripts/test-world/legacy-golden.ts > scripts/test-world/__fixtures__/legacy-keys.txt')
  console.log(JSON.stringify({ epoch: GOLDEN_TODAY, stores }, null, 1))
}
main()
