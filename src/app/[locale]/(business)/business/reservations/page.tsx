// 予約一覧 — the room's route entry, and nothing else.
//
// EVERYTHING BETWEEN THE GATE AND THE RENDER LIVES IN `reservations-props.ts`
// (the room-3 F1 law, the shape 録音 already ships), so the evidence harness
// renders the SAME assembly this route does rather than a hand-written replica
// of it. What stays here is what a route entry owns: the admission gate, the
// params, the sheet import, the M-87 failure branch and the store-scoped key.
//
// M-87: a failed read replaces both panels with one red strip and drops every
// figure to 「—」. Fixtures cannot throw today; the branch ships because the
// mock's own rule — 「この画面の数字は1つも残さない」 — is a correctness
// requirement that has to be in place BEFORE the reads become real.
//
// ⚠ THE ADMISSION 404 IS TAKEN BEFORE THE TRY, and that is load-bearing:
// `notFound()` throws too, so a catch-all around it would show a denied session
// the screen chrome instead of a 404 — the show-and-refuse the isolation law
// forbids. The suite pins both halves.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { ReservationsScreen } from './ReservationsScreen'
import { reservationsProps } from './reservations-props'
import './reservations.css'

export default async function ReservationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, { store }] = await Promise.all([params, searchParams])

  // ⚠ THE TRY WRAPS THE READ, NOT THE RENDER. React does not render a component
  // when its JSX is constructed, so an error thrown DURING render would walk
  // straight past a catch built around the element — the rule the lint states,
  // and the reason M-87's branch is decided on the assembly's own result rather
  // than on a try/catch around a `<ReservationsScreen/>`.
  let assembled: Awaited<ReturnType<typeof reservationsProps>> | null = null
  try {
    assembled = await reservationsProps({ locale, store })
  } catch {
    // M-87. Nothing is re-read and nothing is guessed.
    assembled = null
  }
  if (assembled === null) return <ReservationsScreen failed locale={locale} />

  // ⚖ VIEW STATE IS STORE-SCOPED (the recording page's own precedent). A
  // `?store=` navigation keeps the same screen instance, so the open rail card,
  // the picked slot, the lit chip and the selected row would all survive a lens
  // switch — one store's decision standing over another store's list.
  return <ReservationsScreen key={assembled.storeKey} {...assembled.props} />
}
