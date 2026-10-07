// Sample message/payment facts seated on the bookings the lens actually reads.
import type { FixtureAppointment } from '../fixtures'
import { threads, type FixtureThread } from '../fixtures-inbox'
import { cashTolerance, closing, transactions, type FixtureTransaction } from '../fixtures-register'
import { decisions } from '../fixtures-today'
import { auditTrail, reservations } from '../fixtures-reservations'
import { jstMinuteOfDay } from '../clock'
import { INBOX_WINDOW_DAYS } from '../inbox'
import { tenderChannel } from '../register'
import { fixtureIdOf, liveIdOf, samplePolicyFor } from './registry'

export { INBOX_WINDOW_DAYS }

/** FNV-1a over the entire id: every per-booking choice below reads this alone. */
export const hash = (id: string): number => {
  let n = 2166136261
  for (const c of id) n = Math.imul(n ^ c.charCodeAt(0), 16777619)
  return n >>> 0
}

/** The fixture world's own thread ratio: 5 booking-backed threads over 23 bookings in reach. */
const THREAD_SLOTS = 23
const THREAD_SHARE = 5
const noshowTemplate = threads.find((t) => t.appointment_id !== null && t.category === 'noshow')!
const bookingTemplates = threads.filter((t) => t.appointment_id !== null && t.category !== 'noshow' && t.category !== 'waitlist')
const firstChange = bookingTemplates.find((t) => t.category === 'change')!

/** One rule per booking, from its own hash only — inserting or removing another
 *  booking never relabels this one. Cancelled → none; 無断キャンセル → the noshow
 *  template; else a thread iff hash % 23 < 5, its template by (hash >>> 8). */
export function inboxFor(bookings: FixtureAppointment[]): { threads: FixtureThread[] } {
  const customerOnly = threads.filter((t) => t.appointment_id === null).flatMap((t) => {
    const customer = liveIdOf('customers', t.customer_id)
    return customer && bookings.some((b) => b.customer_id === customer)
      ? [{ ...t, id: `smp-thr-${t.id}`, customer_id: customer }] : []
  })
  const canonical = (id: string) => threads.find((t) => t.appointment_id !== null && t.appointment_id === fixtureIdOf('appointments', id))
  const eligible = bookings.filter((b) => b.status !== 'cancelled')
  const templateOf = (b: FixtureAppointment): FixtureThread | undefined =>
    canonical(b.id) ?? (b.board_state === 'noshow' ? noshowTemplate
      : hash(b.id) % THREAD_SLOTS < THREAD_SHARE ? bookingTemplates[(hash(b.id) >>> 8) % bookingTemplates.length] : undefined)
  const chosen = new Map(eligible.flatMap((b) => { const t = templateOf(b); return t ? [[b.id, t] as const] : [] }))
  if (eligible.length > 0 && chosen.size === 0) {
    const floor = eligible.reduce((lo, b) => hash(b.id) < hash(lo.id) ? b : lo)
    chosen.set(floor.id, firstChange)
  }
  const seated = eligible.flatMap((booking): FixtureThread[] => {
    const template = chosen.get(booking.id)
    if (!template) return []
    const own = template === canonical(booking.id)
    const twin = fixtureIdOf('appointments', booking.id)
    const decision = twin !== null && decisions.some((d) => d.appointment_id === twin)
    const exception = twin !== null && reservations.some((r) => r.appointment_id === twin)
    const audit = twin === null ? [] : (auditTrail[twin] ?? [])
    return [{
      ...template, id: `smp-thr-${booking.id}`, appointment_id: booking.id, customer_id: booking.customer_id,
      delivery_state: decision ? null : template.delivery_state,
      delivery_detail: decision ? null : template.delivery_detail,
      // A templated seat never carries the fixture's own source proof (its names belong to the fixture world).
      source_proof: !own || decision || exception ? null : template.source_proof,
      due: exception ? null : template.due,
      events: template.events.filter((event) => !audit.some((row) => row.every((s, i) => s === event[i]))),
    }]
  })
  return { threads: [...seated, ...customerOnly] }
}

export function registerFor(bookings: FixtureAppointment[], storeId: string | null) {
  const labels = [...new Set(transactions.flatMap((t) => t.tenders.filter((t) => t.flag === '').map((t) => t.label)))]
  const seated = bookings.map((booking): FixtureTransaction => {
    const twin = transactions.find((t) => t.appointment_id === fixtureIdOf('appointments', booking.id) && t.appointment_id !== null)
    // A twin is canonical only while its settled tenders equal the LIVE price;
    // otherwise every store uses the same single-tender settlement rule.
    const safe = twin && twin.tenders.length > 0 && twin.tenders.every((t) => t.flag === '') && twin.tenders.reduce((n, t) => n + t.amount, 0) === (booking.booked_price ?? 0)
    return safe ? { ...twin, id: `smp-tx-${booking.id}`, appointment_id: booking.id, customer_id: null, store_id: null, item: null, amount: null,
      tenders: twin.tenders.map((t) => ({ ...t })), audit: twin.audit.map((r) => [...r] as typeof r) } : {
      id: `smp-tx-${booking.id}`, appointment_id: booking.id, customer_id: null, store_id: null, item: null, amount: null,
      at: jstMinuteOfDay(booking.ends_at), audit: [],
      tenders: [{ label: labels[hash(booking.id) % labels.length], amount: booking.booked_price ?? 0, flag: '' }],
    }
  })
  const policy = storeId === null ? null : samplePolicyFor(storeId)
  const base = policy?.kind === 'twin' ? closing[policy.fixtureStoreId] : null
  const cash = seated.flatMap((t) => t.tenders).filter((t) => tenderChannel(t.label, t.flag) === 'cash').reduce((n, t) => n + t.amount, 0)
  let remaining = (base?.cash_float ?? 0) + cash
  const counted = remaining
  const sheet = base?.cash_count_sheet.map(({ denomination }) => {
    const count = Math.floor(remaining / denomination)
    remaining -= count * denomination
    return { denomination, count }
  }) ?? []
  return { transactions: seated, cashTolerance, closing: base ? {
    ...base, cash_paid_in: 0, cash_paid_out: 0, cash_bank_deposit: 0,
    cash_counted: counted, cash_count_sheet: sheet,
  } : null }
}
