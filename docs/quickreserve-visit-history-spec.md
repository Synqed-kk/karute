# Spec: customer visit + payment history (QuickReserve)

**For:** Anthony · **Status:** UI built + held (`feat/customer-visit-history`, PR #180) · **Blocker:** the QR endpoint the live path + the deep crawl both rely on is dead.

## TL;DR
The customer page has a new **予約履歴** tab, fully built and designed, sitting in a "準備中 / coming soon" state. It just needs a backend read that returns a customer's reservation history. The obvious source — `get-customer-reservations-by-customer-id` — is **version-locked and returns 400**, so this needs the by-date path instead.

## The blocker (verified on the preview)
`POST .../get-customer-reservations-by-customer-id` returns **400** for every payload shape tried (numeric id, string id, data-grid envelope):

```json
{"message":"管理画面の新しいバージョンが利用可能です。ページを更新し、最新の状態でご利用ください。"}
```

It's a **version gate** — that endpoint now requires a console version we don't send. This matters for you too: **the deep crawl (`api/sync/quickreserve-deep`) calls this exact endpoint**, so it's blocked on the same wall (likely why it's never run cleanly).

What still works, same session/headers: `get-customers-server-side` and **`get-reservations-by-date`** (the daily sync uses the latter every day — proven).

## The fix (recommended)
Backfill history through the **working** `get-reservations-by-date` endpoint instead of the dead by-customer one:

1. Over a date range (e.g. last 24 months, one call per day — same call the daily sync already makes), collect reservations and group by customer.
2. Persist per-visit rows to a **readable** store — `customer_visits` already exists for this; the issue is there's no READ. Map with the existing `mapVisit()` (`src/lib/quickreserve.ts`): `{ qr_reservation_id, used_at, status (settled|booked|cancelled), course_name, sales_amount, staff_name, treatment_comment }`.
3. Expose a read: `synqed.customers.listVisits(customerId)` (or include `visits` in `customers.get`).
4. Switch the deep crawl off `get-customer-reservations-by-customer-id` → by-date aggregation (kills the 400 there too).

## Data contract (what the UI consumes)
The tab calls `getCustomerVisitHistory(name, memberNumber)` in `src/lib/customers/visit-history.ts` (currently stubbed to `pending`). To go live, point it at the read and run rows through the exported `summarizeVisits()` — **no UI change**. The shapes:

```ts
type VisitStatus = 'settled' | 'booked' | 'cancelled'

interface CustomerVisit {
  qrReservationId: number
  date: string            // ISO, reservation start
  courseName: string | null
  staffName: string | null
  status: VisitStatus
  salesAmount: number     // yen, 0 if no settled bill
  note: string | null
}
// summarizeVisits() derives: totalVisits, totalSpend, avgSpend, firstVisit,
// lastVisit, cancelledCount, avgIntervalDays (cadence).
```

The read only needs to return `CustomerVisit[]` for a customer (most-recent-first). The UI does the rest.

## Karute side (done / waiting)
- ✅ Tab + summary band + visit timeline (`BookingHistoryTabContent`), ja↔en, held in `pending`.
- ✅ `summarizeVisits()` + the contract types.
- ⏳ One-line swap in `getCustomerVisitHistory` once the read exists.
