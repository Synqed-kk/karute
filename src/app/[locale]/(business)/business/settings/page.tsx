// 設定 — the room every other room's setting was promised to. Nineteen canon
// pages, all built, all live: the eighteen `fable-settings-*.html` pages plus
// `fable-billing-plan.html`, carried into one route behind a category rail.
//
// SERVER COMPONENT ON PURPOSE, like every other room: every read, join and date
// format happens here, so the client receives plain strings. No timezone and no
// locale can drift between the two renders, and no data access exists on the
// client at all.
//
// Reserve card colour is now a narrowly authorized live setting. Its section
// states this explicitly; the remaining settings below are still demo-only.
// ⚖ THE OTHER SETTINGS DO NOT WRITE TO PRODUCT DATA.
// Every control is live and every save commits — inside this screen. The page's
// サンプルデータ dateline and ONE footnote per store section carry that fact;
// 自分の表示設定 is the single exception and it is a designed one, saving to this
// browser for this reader, because a self-scoped preference is nobody else's
// permission.
//
// ⚖ THE THREE DOCTRINE LINES, for this room:
//  · N-STORES — per-store, ONE lens, and the room PRINTS the scope of every
//    policy row (事業全体 / この店舗) rather than leaving a manager to assume.
//    There is no unbounded all-store read: one store's settings are fetched by
//    id. The rail is a fixed twenty-one rows, so nothing here grows with the
//    roster or the estate.
//  · HQ — 本部 will read WHICH stores diverge from the brand's own defaults, as
//    counts. It is not built, and no per-store value crosses a store boundary
//    today.
//  · TYPE — Tier 2, and only where a ruling actually gave one: 現金差異 (a
//    treatment shop's ¥0 against a cash shop's few hundred yen), 休憩の有給扱い,
//    再来促しの日数 and コーチングの利用 (its wording, not the switch itself,
//    changes by business type). Nothing on this page BRANCHES on a business type
//    — the type note is printed beside the row, and the suite pins that.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { SettingsScreen } from './SettingsScreen'
import { settingsProps } from './settings-props'
import './settings.css'

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string; section?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  // Everything between the gate and the render lives in `settings-props.ts`, so
  // the evidence harness renders the SAME assembly this route does rather than a
  // hand-written replica of it.
  //
  // ⚖ LINKED UP. `?section=` is how a trace card in another room lands on the
  // setting it points at instead of on whatever this page opens with. An unknown
  // or gated section falls back to the first one this reader may open.
  const { props, storePolicy, storeKey } = await settingsProps({ locale, store: query.store, section: query.section })

  // ⚖ VIEW STATE IS STORE-SCOPED. `?store=` navigation keeps the same screen
  // instance, so the open section AND every control's value would survive a lens
  // switch — 銀座's コーチング panel left standing over 代官山's settings, which
  // is the isolation law failing at the frame rather than at the read. Keying by
  // the resolved lens resets both, which is what a shop expects when it changes
  // which store it is looking at.
  return <SettingsScreen key={storeKey} {...props} storePolicy={storePolicy} />
}
