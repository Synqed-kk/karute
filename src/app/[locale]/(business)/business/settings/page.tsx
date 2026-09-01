// 予約と確保 — the store's own booking + 確保 dials, and the FIRST room under the
// rail's 設定 group.
//
// ⚖ Liam 9/1 (PKT-BUILD-SETTINGS §1, the approved `settings-mock.html`): a NEW
// 設定 room hosts the mock's anatomy — presets → live preview → 詳細設定 — and
// follows every door law: the shared shell, a Sidebar entry, the guided ?-tour
// with `data-guide` on every section (⚖ 8/23, same round), R13 + the one-way
// accent, and the family's own Japanese.
//
// SERVER COMPONENT ON PURPOSE, like every other room: the store's dials are read
// here and the client receives plain values. No data access exists on the client.
//
// ⚠ PLAY-PHASE, AND THE FENCE IS THE REASON. Every value below comes from
// `src/business/lib/data.ts` reading fixtures. The charter's persistence split
// asks for the two live wire fields (`gap_guard_mode`,
// `new_client_session_minutes`) to be read and written through
// `StorePolicyClient` — and THREE independent machines forbid a core reach from
// Business territory today: `scripts/business/check-business-data-access.mjs`
// (「NO DIRECT core reach, anywhere — @synqed-kk/client」, and 「NO writes,
// anywhere」), the import allowlist in
// `src/__tests__/integration/business-isolation.test.ts` (which names
// `@synqed-kk/client` as an offender in as many words), and the CI diff gate,
// which refuses a Business PR that touches the guard scripts at all. Their own
// headers say the reconnection is 「a deliberate PR on Liam's word that has to
// amend this file」, and `scripts/business/` is CODEOWNER-gated so that PR gets
// owner review by construction. So the room ships the dials FIXTURE-BACKED with
// the honest note pattern, and `./store-policy-seam.ts` is the one file the swap
// lands in. Reported to Liam as the round's one deviation.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { defaultStoreId, listStoreOptions, readDayPlanes, readShellIdentity, renderNow, type StoreLens } from '@/business/lib/data'
import { jstDayKey } from '@/business/lib/clock'
import { SettingsScreen, type SettingsProps } from './SettingsScreen'
import './settings.css'

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string }>
}) {
  await requireBusinessAdmission()
  const [, query] = await Promise.all([params, searchParams])
  const storeOptions = await listStoreOptions()
  // A missing or unknown ?store= opens on the operator's own store, never the
  // business-wide merge — すべての店舗 left the sidebar switcher (⚖ Liam 8/20)
  // and `defaultStoreId` owns that rule for every screen.
  const storeId = defaultStoreId(query.store, storeOptions)
  const lens: StoreLens = storeId !== null ? storeId : { viewAll: true }

  // ONE CLOCK READ PER RENDER, the family's own rule (Greptile P1 on #724).
  const [planes, shell] = await Promise.all([readDayPlanes(lens, jstDayKey(renderNow())), readShellIdentity()])

  const props: SettingsProps = {
    // ⚖ VIEW STATE IS STORE-SCOPED (the 売上・レジ precedent): `?store=`
    // navigation keeps the same screen instance, so a preset chosen against one
    // store's dials would still be pressed over another store's. The key below
    // resets it, which is what a shop expects when it changes whose rules it is
    // looking at.
    storeKey: storeId ?? 'all',
    storeLabel: storeId !== null ? (storeOptions.find((s) => s.id === storeId)?.name ?? 'この店舗') : 'すべての店舗',
    policy: {
      strict: planes.opsConfig.gapGuardMode === 'strict',
      newClientMinutes: planes.opsConfig.newClientSessionMin,
    },
  }

  return <SettingsScreen key={props.storeKey} {...props} />
}
