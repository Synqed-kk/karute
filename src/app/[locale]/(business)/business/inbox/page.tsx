// 受信トレイ — the canon screen (fable-store-inbox.html), transplanted whole
// under ⚖ Liam's 8/19 transplant ruling: same structure, same layout, same
// wording, running on PLAY-PHASE FIXTURES.
//
// SERVER COMPONENT ON PURPOSE, like every other room: every read, join,
// deadline and time format happens here, so the client receives plain strings.
// No timezone and no locale can drift between the two renders, and no data
// access exists on the client at all.
//
// READING AND TRIAGE ARE BUILDABLE; SENDING IS A WRITE. Canon's 返信する and
// 対応を完了する both change the world — one sends a message to a real person,
// the other writes a resolution and an operator into the record. Both ship
// REFUSED with their reason, in the family's own grammar, and both are named in
// the build report's registry rather than half-built behind a dialog whose only
// outcome is a toast saying nothing happened (the dead-lever class one level
// down — 予約一覧 and スタッフ・シフト set that precedent).
//
// ONE FIXTURE WORLD, and this room is the one that proves it: a thread's
// deadline is 予約一覧's own `deadlineOf`, its status is 今日の運営's own
// 次に決めること card, its booking line is the appointment every other room
// paints, its 履歴 is that booking's own 操作履歴, and its 連絡同意 is the
// 顧客台帳's — in the 顧客 screen's own words. The room states almost nothing of
// its own, which is the point.
//
// THE STORE LENS IS THE ONLY GATE. Canon puts no role gate on this page (no
// 権限 copy, no role word, no hidden branch in its script — grepped), so the
// room ships ungated and the question 「who may read customer messages」 is
// raised by name in the settings registry rather than invented here.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { InboxScreen } from './InboxScreen'
import { inboxProps } from './inbox-props'
import './inbox.css'

export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  // Everything between the gate and the render lives in `inbox-props.ts`, so
  // the evidence harness renders the SAME assembly this route does rather than
  // a hand-written replica of it.
  const { props, storeKey } = await inboxProps({ locale, store: query.store })

  // ⚖ VIEW STATE IS STORE-SCOPED. `?store=` navigation keeps the same screen
  // instance, so the filter, the open thread and the ≤743 detail flag used to
  // survive a lens switch — a 銀座 filter still pressed over a 代官山 queue,
  // and a selection pointing at a thread the new store cannot see. Keying by
  // the resolved lens resets all of it, which is what a shop expects when it
  // changes which store it is looking at.
  return <InboxScreen key={storeKey} {...props} />
}
