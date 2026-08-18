// 顧客一覧 — Business screen #1, on 見本 data (play phase).
//
// Route: the (business) group adds no URL segment, and /[locale] +
// /[locale]/customers are already the phone app's, so Business lives under a
// /business/ segment. Authorization is the group layout's admission gate.
// Server component on purpose: reads, the appointment join and every date
// format happen here, so the client gets plain strings and no timezone or
// locale can drift between the two renders.

import Link from 'next/link'
import { businessStrings } from '@/business/i18n'
import { listAppointments, listCustomers, listStoreOptions, type StoreLens } from '@/business/lib/data'
import { CustomerTable, type CustomerRow } from './CustomerTable'

const s = businessStrings.customers

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDay = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', ...JST })
const fmtTime = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, ...JST })

/** 8月19日 10:00–11:00, always in JST — the operator's clock, not the server's. */
const formatSlot = (startsAt: string, endsAt: string) =>
  `${fmtDay.format(new Date(startsAt))} ${fmtTime.format(new Date(startsAt))}–${fmtTime.format(new Date(endsAt))}`

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string }>
}) {
  const [{ locale }, { store }] = await Promise.all([params, searchParams])
  const storeOptions = await listStoreOptions()
  // An unknown ?store= falls back to every store rather than erroring: the
  // lens is a view preference, and the wrapper is the thing that clamps.
  const lens: StoreLens = storeOptions.some((o) => o.id === store) ? store! : { viewAll: true }

  const [customers, appointments] = await Promise.all([
    listCustomers(lens),
    listAppointments(lens),
  ])

  // Next booking per customer, within the lens: earliest still-booked slot.
  const nextByCustomer = new Map<string, string>()
  for (const a of [...appointments].sort((x, y) => x.starts_at.localeCompare(y.starts_at))) {
    if (a.status !== 'booked' || nextByCustomer.has(a.customer_id)) continue
    nextByCustomer.set(a.customer_id, formatSlot(a.starts_at, a.ends_at))
  }

  const rows: CustomerRow[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    furigana: c.furigana,
    memberNumber: c.member_number,
    phone: c.phone,
    nextSlot: nextByCustomer.get(c.id) ?? null,
    ticketBalance: c.ticket_balance,
    verified: c.verified,
  }))

  const href = (id?: string) => `/${locale}/business/customers${id ? `?store=${id}` : ''}`

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h1 className="text-base font-semibold">{s.title}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {s.summary.replace('{count}', String(rows.length))}
          </p>
        </div>
        {/* Store lens. Selected = light accent wash, never a filled dark chip (R13). */}
        <nav className="flex items-center gap-1.5">
          {[{ id: undefined, name: s.allStores }, ...storeOptions].map((o) => {
            const active = o.id === store || (!o.id && !storeOptions.some((x) => x.id === store))
            return (
              <Link
                key={o.id ?? 'all'}
                href={href(o.id)}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? 'border-primary bg-primary/8 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {o.name}
              </Link>
            )
          })}
        </nav>
      </div>
      <CustomerTable rows={rows} />
    </section>
  )
}
