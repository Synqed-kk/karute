// Sample message/payment facts seated on the bookings the lens actually reads.
import type { FixtureAppointment } from '../fixtures'
import { threads, type FixtureThread, type ThreadCategory } from '../fixtures-inbox'
import { cashTolerance, closing, transactions, type FixtureTransaction } from '../fixtures-register'
import { decisions } from '../fixtures-today'
import { auditTrail, reservations } from '../fixtures-reservations'
import { jstMinuteOfDay } from '../clock'
import { tenderChannel } from '../register'
import { fixtureIdOf, liveIdOf, samplePolicyFor } from './registry'

/** FNV-1a over the entire id; hash order + weighted deficits preserve the fixture category mix. */
const hash = (id: string): number => {
  let n = 2166136261
  for (const c of id) n = Math.imul(n ^ c.charCodeAt(0), 16777619)
  return n >>> 0
}

export function inboxFor(bookings: FixtureAppointment[]): { threads: FixtureThread[] } {
  const customerOnly = threads.filter((t) => t.appointment_id === null).flatMap((t) => {
    const customer = liveIdOf('customers', t.customer_id)
    return customer && bookings.some((b) => b.customer_id === customer)
      ? [{ ...t, id: `smp-thr-${t.id}`, customer_id: customer }] : []
  })
  const ordered = [...bookings].sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id))
  const categories = [...new Set(threads.map((t) => t.category))]
  const canonical = (id: string) => threads.find((t) => t.appointment_id !== null && t.appointment_id === fixtureIdOf('appointments', id))
  const counts = Object.fromEntries(categories.map((c) => [c, ordered.filter((b) => canonical(b.id)?.category === c).length + customerOnly.filter((t) => t.category === c).length])) as Record<ThreadCategory, number>
  const deficit = (t: FixtureThread) => (bookings.length + customerOnly.length) * threads.filter((f) => f.category === t.category).length / threads.length - counts[t.category]
  const seated = ordered.map((booking): FixtureThread => {
    const twin = fixtureIdOf('appointments', booking.id)
    const candidates = threads.map((_, i) => threads[(hash(booking.id) + i) % threads.length])
    const own = canonical(booking.id)
    const template = own ?? candidates.reduce((best, t) => deficit(t) > deficit(best) ? t : best)
    if (!own) counts[template.category] += 1
    const decision = twin !== null && decisions.some((d) => d.appointment_id === twin)
    const exception = twin !== null && reservations.some((r) => r.appointment_id === twin)
    const audit = twin === null ? [] : (auditTrail[twin] ?? [])
    return {
      ...template, id: `smp-thr-${booking.id}`, appointment_id: booking.id, customer_id: booking.customer_id,
      delivery_state: decision ? null : template.delivery_state,
      delivery_detail: decision ? null : template.delivery_detail,
      source_proof: decision || exception ? null : template.source_proof,
      due: exception ? null : template.due,
      events: template.events.filter((event) => !audit.some((row) => row.every((s, i) => s === event[i]))),
    }
  })
  return { threads: [...seated, ...customerOnly] }
}

export function registerFor(bookings: FixtureAppointment[], storeId: string | null) {
  const labels = [...new Set(transactions.flatMap((t) => t.tenders.filter((t) => t.flag === '').map((t) => t.label)))]
  const seated = bookings.map((booking): FixtureTransaction => {
    const twin = transactions.find((t) => t.appointment_id === fixtureIdOf('appointments', booking.id) && t.appointment_id !== null)
    // A twin is canonical only while its settled tenders equal the LIVE price;
    // otherwise every store uses the same single-tender settlement rule.
    const safe = twin && twin.tenders.every((t) => t.flag === '') && twin.tenders.reduce((n, t) => n + t.amount, 0) === (booking.booked_price ?? 0)
    return safe ? { ...twin, id: `smp-tx-${booking.id}`, appointment_id: booking.id, customer_id: null, store_id: null, item: null, amount: null } : {
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
