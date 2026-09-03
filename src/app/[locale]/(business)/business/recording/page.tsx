// 録音 — the computer door onto the SAME recording sessions the phone app mints.
// One truth, two doors: the six states, the consent contract, the
// written-reason discard, the accidental-tap floor and the three transcript
// absence states all come from the phone's own shipped stack, and this room
// invents none of them.
//
// SERVER COMPONENT ON PURPOSE, like every other room: every read, join, day
// index and date format happens here, so the client receives plain strings and
// one integer day axis. No timezone and no locale can drift between the two
// renders, and no data access exists on the client at all.
//
// THE DEMO MACHINE RUNS; EVERY REAL WRITE REFUSES. ⚖ R6-D3: 「この録音を使う」
// refuses with an honest reason — a demo commit would claim a カルテ change the
// カルテ room provably does not show — while the DISCARD flow demos to the end,
// because a self-contained ephemeral receipt claims nothing about anybody's
// record. Real capture (registry ①), a persisted consent (⑥), the カルテ commit
// (⑦), the ✓確認済み mark (⑩) and every settings dial (⑨) are named in the
// build report's registry rather than half-built behind a dialog whose only
// outcome is a toast saying nothing happened.
//
// THE STORE LENS IS THE GATE. ⚖ the 8/17 isolation law: a bound take enters this
// page only through a booking the clamped door returned and an unbound one only
// through its own store, so another store's takes are not filtered out of the
// props — they never enter them. What is ROLE-gated is the store-wide scope and
// a discarded take's reason and transcript, and both of those redactions also
// happen above the serializer, for the same reason.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { RecordingScreen } from './RecordingScreen'
import { recordingProps } from './recording-props'
import './recording.css'

export default async function RecordingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string; recovery?: string; discardFail?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  // Everything between the gate and the render lives in `recording-props.ts`, so
  // the evidence harness renders the SAME assembly this route does rather than a
  // hand-written replica of it.
  const { props, storeKey } = await recordingProps({
    locale,
    store: query.store,
    recovery: query.recovery,
    // ⚖ W7-2 — the refused write's rendering, behind its own named param, the
    // `?recovery=1` precedent: a designed shape a reconnect will land on, off by
    // default because a dialog that always fails claims a failure that did not
    // happen.
    discardFail: query.discardFail,
  })

  // ⚖ VIEW STATE IS STORE-SCOPED. `?store=` navigation keeps the same screen
  // instance, so the picked booking, the demo machine's elapsed seconds, an open
  // dialog and the 破棄の記録 screen would all survive a lens switch — a 銀座
  // take being recorded over a 代官山 desk, which is the isolation law failing at
  // the frame rather than at the read. Keying by the resolved lens resets all of
  // it, which is what a shop expects when it changes which store it is looking
  // at.
  return <RecordingScreen key={storeKey} {...props} />
}
