// コーチング — the computer door onto the coaching system the phone app carries
// dormant. One truth, two doors: the metric spine (成約率・再来率・満足度・平均
// 客単価・「後で決める」), the honest-not-sweet findings with their receipts, the
// trajectory BANDS and the whole visibility wall come from the phone's own
// design (src/lib/karute/coaching/contract.ts, docs/coaching/*), mirrored BY
// SHAPE with cites — Business territory may not import phone runtime.
//
// SERVER COMPONENT ON PURPOSE, like every other room: every read, join, month
// tick and date format happens here, so the client receives plain strings. No
// timezone and no locale can drift between the two renders, and no data access
// exists on the client at all.
//
// ⚖ NOTHING ON THIS PAGE IS CONNECTED, AND EVERY LEVER SAYS SO. Generation costs
// money, consent is a legal record, the depth-share is a permission a staff
// member owns and the dials belong to the 設定 room — so each ships REFUSED with
// its own reason naming the registry line it reconnects through, rather than
// half-built behind a control whose only outcome is a toast.
//
// ⚖ THE THREE DOCTRINE LINES, for this room:
//  · N-STORES — per-store, ONE lens. 全スタッフ表示 is THIS store's roster and
//    there is no unbounded all-store read; the roster obeys ANY-ROSTER-SIZE (the
//    25+ proof is a test-world matter, the demo plane stays small).
//  · HQ — 本部 reads ADOPTION AGGREGATES and store-level figures ONLY.
//    Anti-coercion outranks the roll-up: content never crosses, and a per-staff
//    band never leaves its store.
//    ⚖ B2-2-4 (S16F) — AND THAT DOOR IS BUILT NOW, on the money screen. This
//    line used to end 「Registry ⑥ is that door; it is not built here」, and I-10
//    made it false in the same round it was read in: 導入の状況 carries the two
//    adoption counts over this store's roster and ONE LINE PER STORE — whether
//    the module is on, plus that store's own headline lift and its confidence
//    label where it is. That is a store aggregate and nothing else; there is no
//    per-staff field in `StoreCoachingRoi` for one to travel in, and the gate is
//    `access.viewRoi`. What registry ⑥ still owes is the REAL cross-store read:
//    every store's line comes from this room's own fixture plane today.
//  · TYPE — a CAPABILITY SWITCH (the module is on or off per store) plus Tier-2
//    defaults through the business-type tokens, mirrored by shape. Nothing on
//    this page branches on a business type.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { CoachingScreen } from './CoachingScreen'
import { coachingProps } from './coaching-props'
import './coaching.css'

export default async function CoachingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string; as?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  // Everything between the gate and the render lives in `coaching-props.ts`, so
  // the evidence harness renders the SAME assembly this route does rather than a
  // hand-written replica of it.
  // ⚠ `?as=` IS THE ROLE PREVIEW'S ONLY INPUT, and it is honoured ONLY behind
  // the build-time preview gate (`isRolePreviewEnabled`, mirrored from
  // `coaching-dev-preview/hooks.ts:49-54`). A production build folds it to the
  // reader's real role, so the query cannot become a privilege by being typed —
  // and the real admission gate above is untouched either way.
  const { props, storeKey } = await coachingProps({ locale, store: query.store, as: query.as })

  // ⚖ VIEW STATE IS STORE-SCOPED. `?store=` navigation keeps the same screen
  // instance, so the open tab and the tour step would survive a lens switch —
  // a 全スタッフ表示 board for 銀座 left standing over a 代官山 desk, which is the
  // isolation law failing at the frame rather than at the read. Keying by the
  // resolved lens resets both, which is what a shop expects when it changes
  // which store it is looking at.
  return <CoachingScreen key={storeKey} {...props} />
}
