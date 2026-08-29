// 売上・レジ — the day's money desk (canon `fable-store-sales-register.html`),
// transplanted under ⚖ Liam's 8/19 transplant ruling: canon's behaviour, the
// 受信トレイ TEMPLATE's layout, running on PLAY-PHASE FIXTURES.
//
// SERVER COMPONENT ON PURPOSE, like every other room: every read, join, sum and
// money format happens here, so the client receives plain strings. No timezone,
// no locale and no rounding can drift between the two renders, and no data
// access exists on the client at all.
//
// READING IS BUILDABLE; EVERY BUTTON ON A MONEY DESK IS A WRITE. 返金・取消
// moves real money back to a real person. 計数を保存 records a count and a
// reason against a day. 閉店を確定 closes a ledger. 再接続を確認 talks to a
// physical terminal. Every one of them ships REFUSED with its own reason on its
// own accessible name, and the CONTENT canon puts behind a dialog for them —
// what a refund would reverse, what a close would record — is shown as read-only
// evidence beside the refused control, because refusing to act is honest and
// hiding what the action would have done is not.
//
// ONE FIXTURE WORLD, and this room joins the most of it: a transaction's total
// is the booking's own 受付価格, its line is the menu's own name, its store is
// the booking's store, its 監査履歴 merges the booking's own 操作履歴, the cards
// the terminal is holding are the same rows 今日の運営 counts, and the day's
// refunds are the same ¥1,100 that board already subtracts. The money plane
// states only what a register knows and no booking row carries — which tender,
// what is owed, what was reversed, what someone counted in the drawer.
//
// THE CAPABILITY GATE IS READ, NOT INVENTED. Canon gates sixteen controls on
// `close` and three on `refund`; there is no capability in the real grants model
// (`admission.ts` returns a user, a business and nothing else), so the room
// reads the operator's role from the fixture plane and names the real dial in
// the build report's registry rather than guessing a contract.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { RegisterScreen } from './RegisterScreen'
import { registerProps } from './register-props'
import './register.css'

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  // Everything between the gate and the render lives in `register-props.ts`, so
  // the evidence harness renders the SAME assembly this route does rather than
  // a hand-written replica of it (the room-3 F1 law).
  const { props, storeKey } = await registerProps({ locale, store: query.store })

  // ⚖ VIEW STATE IS STORE-SCOPED. `?store=` navigation keeps the same screen
  // instance, so the filter, the open transaction and the ≤743 detail flag would
  // otherwise survive a lens switch — a 銀座 filter still pressed over a 代官山
  // ledger, and a selection pointing at a transaction the new store cannot see.
  // Keying by the resolved lens resets all of it, which is what a shop expects
  // when it changes which store's money it is looking at.
  return <RegisterScreen key={storeKey} {...props} />
}
