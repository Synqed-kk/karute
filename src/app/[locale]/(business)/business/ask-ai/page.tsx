// AI相談 — the computer door onto the SAME AI the phone app already ships, plus
// the suggestion feed canon designed for the desk. One system, two doors: who
// may ask, what an answer is allowed to know, what comes back and what is kept
// are the phone's own shipped contract, and this room invents none of them.
//
// SERVER COMPONENT ON PURPOSE, like every other room: every read, join, clamp
// and date format happens here, so the client receives plain strings. No
// timezone and no locale can drift between the two renders, and no data access
// exists on the client at all.
//
// READING IS BUILDABLE; ASKING IS A CALL. 送信 would put a real question to a
// real model against real customer records, so it ships REFUSED with its own
// reason naming registry ①, in the family's grammar — never half-built behind a
// composer whose only outcome is a toast saying nothing happened, and never
// behind a fake 「確認しています…」 that pretends work is being done (⚖ D-2).
//
// ⚠ AND THERE IS NO SAVED HISTORY, ANYWHERE, BECAUSE THERE IS NONE TO SHOW.
// The shipped contract keeps no thread: history lives in the client's own state
// and is re-sent whole on every request, and the ONE server write is an audit
// row counting the exchange (`src/app/api/ai/chat/route.ts:113-119` —
// `{ first_turn, history_len }`, never message text). A 相談履歴 surface would be
// a feature invented ahead of its capability (⚖ 8/17: speculative stays off), so
// it is registry ③ and the page says the true thing out loud instead.
//
// THE STORE LENS IS THE GATE, and the persona gate sits above it. A suggestion,
// an evidence line or an 出典 row enters this page only when its record reaches
// the lens through a booking the clamped door returned; a reader whose persona
// does not resolve to a preset holding `customers.view` gets props with none of
// it in them at all. Both redactions happen above the serializer, which is what
// the leaves-nothing-behind pins measure.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { AskAiScreen } from './AskAiScreen'
import { askAiProps } from './ask-ai-props'
import './ask-ai.css'

export default async function AskAiPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  // Everything between the gate and the render lives in `ask-ai-props.ts`, so
  // the evidence harness renders the SAME assembly this route does rather than a
  // hand-written replica of it.
  const { props, storeKey } = await askAiProps({ locale, store: query.store })

  // ⚖ VIEW STATE IS STORE-SCOPED. `?store=` navigation keeps the same screen
  // instance, so the typed question, the refusal on screen and the cards this
  // visit has dismissed would survive a lens switch — a 銀座 suggestion still
  // dismissed over a 代官山 desk, which is the isolation law failing at the frame
  // rather than at the read. Keying by the resolved lens resets all of it, which
  // is what a shop expects when it changes which store it is looking at.
  return <AskAiScreen key={storeKey} {...props} />
}
