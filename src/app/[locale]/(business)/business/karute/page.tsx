// カルテ — the computer door onto the SAME records the phone app writes. One
// truth, two doors: the field set, the labels, the states and the outcome
// vocabulary all come from the phone's own detail-screen contract, and this room
// invents none of them.
//
// SERVER COMPONENT ON PURPOSE, like every other room: every read, join, day
// index and date format happens here, so the client receives plain strings and
// one integer day axis. No timezone and no locale can drift between the two
// renders, and no data access exists on the client at all.
//
// READING IS BUILDABLE; EVERY EDIT IS A WRITE. Canon's 記入内容の編集, AIで再生成,
// 詳細記録を編集, AI提案メッセージの編集・送信, 結果を変更 and カルテの顧客変更 all
// change somebody's medical-adjacent record or send a real person a message.
// Every one of them ships REFUSED with its own reason, in the family's grammar,
// and every one is named in the build report's registry rather than half-built
// behind a dialog whose only outcome is a toast saying nothing happened.
//
// ⚖ AND THERE IS NO DELETE LEVER, ANYWHERE. #547: a karute is never hard-deleted.
// The verb this product has is 破棄 — which KEEPS the record, grays it, and
// attaches a written reason — and that already happened on the phone by the time
// this page can see it. A 削除 control here would be a lever for an operation the
// system does not have.
//
// THE STORE LENS IS THE GATE, and it is the ONLY one on the census. ⚖ the 8/17
// isolation law: a record enters this page only through a booking the clamped
// door returned, so another store's records are not filtered out of the props —
// they never enter them. What IS role-gated is a 破棄済み record's content, and
// that redaction also happens above the serializer, for the same reason.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { KaruteScreen } from './KaruteScreen'
import { karuteProps } from './karute-props'
import './karute.css'

export default async function KarutePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  // Everything between the gate and the render lives in `karute-props.ts`, so
  // the evidence harness renders the SAME assembly this route does rather than
  // a hand-written replica of it.
  const { props, storeKey } = await karuteProps({ locale, store: query.store })

  // ⚖ VIEW STATE IS STORE-SCOPED. `?store=` navigation keeps the same screen
  // instance, so the search box, the filters, the window walk and the open
  // record would survive a lens switch — a 銀座 record still open over a 代官山
  // desk, which is the isolation law failing at the frame rather than at the
  // read. Keying by the resolved lens resets all of it, which is what a shop
  // expects when it changes which store it is looking at.
  return <KaruteScreen key={storeKey} {...props} />
}
