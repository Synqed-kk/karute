// 設定 — the room every other room's dial was promised to. Nine rooms shipped a
// value with a ⚠SETTINGS-BATCH marker beside it and a sentence saying the control
// would live here; this is that page, and its whole job is to show those values
// WITHOUT owning a second copy of any of them.
//
// SERVER COMPONENT ON PURPOSE, like every other room: every read, join and date
// format happens here, so the client receives plain strings. No timezone and no
// locale can drift between the two renders, and no data access exists on the
// client at all.
//
// ⚖ NOTHING STORE-WIDE HERE WRITES, AND EVERY ROW SAYS SO. A store dial decides
// a business's money, its people's time and its staff's privacy; a control whose
// only outcome is a toast would be worse than no control. Each one shows the
// value the product is really using and refuses the change with the registry line
// it reconnects through. 自分の表示設定 is the single exception and it is a
// designed one: a self-scoped preference is nobody else's permission.
//
// ⚖ THE THREE DOCTRINE LINES, for this room:
//  · N-STORES — per-store, ONE lens, and the room PRINTS the scope of every dial
//    (事業全体 / この店舗) rather than leaving a manager to assume. There is no
//    unbounded all-store read: one store's dials are fetched by id. The rail is a
//    fixed twenty rows, so nothing here grows with the roster or the estate.
//  · HQ — 本部 will read WHICH stores diverge from the brand's own defaults, as
//    counts, through registry ①. It is not built, and no per-store dial value
//    crosses a store boundary today.
//  · TYPE — Tier 2, and only where a ruling actually gave one: 現金差異 (a
//    treatment shop's ¥0 against a cash shop's few hundred yen), 休憩の有給扱い
//    and 再来促しの日数. Nothing on this page BRANCHES on a business type — the
//    type note is printed beside the dial, and the suite pins that.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { SettingsScreen } from './SettingsScreen'
import { settingsProps } from './settings-props'
import './settings.css'

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  // Everything between the gate and the render lives in `settings-props.ts`, so
  // the evidence harness renders the SAME assembly this route does rather than a
  // hand-written replica of it.
  const { props, storeKey } = await settingsProps({ locale, store: query.store })

  // ⚖ VIEW STATE IS STORE-SCOPED. `?store=` navigation keeps the same screen
  // instance, so the open section would survive a lens switch — 銀座's コーチング
  // panel left standing over 代官山's dials, which is the isolation law failing at
  // the frame rather than at the read. Keying by the resolved lens resets it,
  // which is what a shop expects when it changes which store it is looking at.
  return <SettingsScreen key={storeKey} {...props} />
}
