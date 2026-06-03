# QuickReserve deep customer crawl — design (Part 2)

Status: **draft for review** · Author: Claude (reverse-engineered from the live QR console, read-only, 2026-06-01) · Owner: Anthony / Liam

## Why
Karute's customer records show blanks/「対応予定」 because we only sync the *reservation list*. QuickReserve's **customer-detail page** holds far more per customer. This spec captures the actual data + the exact QR API endpoints (verified live against La Estro store 222) so we can crawl it into synqed-core and surface it in Karute. This *is* the "full spec with exact fields + data model" that was referenced but never delivered.

## What QR actually exposes (verified)
Endpoints are all `POST https://api.quick-reserve.com/v1/console/la-estro/222/<name>`, authenticated with the same cookie/token login the existing sync already uses (`qrLogin`).

| Endpoint | Returns | Maps to |
|---|---|---|
| `get-customers-server-side` | paginated customer list w/ profile + summary | customer profile + financials |
| `get-customer-reservations-by-customer-id` | full visit/treatment history | new `customer_visits` |
| `get-medical-records-by-customer-id` (+ `get-medical-record-fields-by-store-id`) | QR's own カルテ / medical records + field defs | feeds Part 3 (AI memory) |
| `get-customer-mails-by-customer-id` | email send history | optional |
| `get-customer-lines-by-customer-id` | LINE send history | optional |

### Fields seen on the customer-detail screen
- **Profile:** 会員番号 member#, 性別 gender*, 生年月日 DOB*, TEL1/TEL2, メール1, 郵便番号/都道府県/住所1, DM受け取り opt-in, 職業 occupation, コメント, 備考1*/備考2, 担当スタッフ assigned staff*, 母店 home store.
  (\* gender, DOB, assigned staff, remarks1 already in synqed-core — gender/DOB shipped in Part 1.)
- **顧客サマリ summary:** 既存顧客*, 初回来店日時 first visit, 直近来店日 last visit, 総来店回数 visits*, **総売上金額 total sales**, **分割払い未収金額 installment outstanding**.
- **来店履歴 visit history (grid):** per visit — QR id, 予約日時 booked_at, 利用日時 used_at, 利用店舗 store, 状態 status (e.g. 精算済), **コース course** (e.g. `6回券`, `3回券終了`, `¥13200`), 担当者 staff, **売上金額 sales amount**, 施術コメント treatment comment.
- **分割払い履歴** installment payments, **メール/LINE配信履歴**, **流入経路 UTM** (source/medium/campaign/term/content).

## Proposed synqed-core data model
Additive, business-scoped, idempotent on QR id (store in `external_refs.quickreserve`).

1. **Extend `customers`** (nullable columns): `occupation`, `member_number`, `postal_code`, `prefecture`, `address`, `phone2`, `email2`, `dm_opt_in` (bool), `comment`, `remarks2`, plus denormalized summary `total_sales` (int), `installment_outstanding` (int), `first_visit_at`, `last_visit_at` (timestamptz). (gender/DOB/assigned_staff/visit_count/is_existing already present.)
2. **New `customer_visits`**: `id`, `business_id`, `customer_id` FK, `qr_reservation_id` (unique per business), `booked_at`, `used_at`, `status`, `course_name`, `sales_amount` (int), `treatment_comment`, `staff_name`. Index `(customer_id, used_at)`.
3. **(Phase 2c, optional) `customer_payments`** for installment history; `customer_messages` for mail/LINE; UTM onto `customers` or its own row.

## Crawl approach
Extend the existing sync (`src/app/api/sync/quickreserve/route.ts`, `src/lib/quickreserve.ts`):
- Page through `get-customers-server-side`; for each customer upsert profile+summary into synqed-core (keyed on QR customer id via `external_refs`).
- For each, call `get-customer-reservations-by-customer-id` → upsert `customer_visits` (idempotent on `qr_reservation_id`).
- Reuse `sync_config` creds + `qrLogin`. **Read-only against QR.** Run as a separate cron from the daily reservation sync (it's a heavier, per-customer N+1 crawl — batch + backoff).
- Volume unknown (La Estro list is large) → must paginate + be resumable; log what's skipped.

## Karute surfaces
Customer profile page: occupation/DOB/age/gender/address; a **visit-history timeline** (course + amount + treatment comment); **total sales / outstanding**; ticket/course balances. The treatment comments + QR medical records become inputs to **Part 3 (AI Customer Memory)**.

## Phasing
- **2a** — extend `customers` profile + summary fields + crawl from `get-customers-server-side`.
- **2b** — `customer_visits` table + per-customer history crawl + Karute timeline.
- **2c** — payments, messages, UTM, medical records (latter feeds Part 3).

## Open questions
1. **Ticket / course balances (回数券残):** seen as course labels in visit history (`6回券`, `3回券終了`) but no explicit balance section on the detail page — likely a separate endpoint (`get-treatment-courses`?) or derived. Needs one more read-only dig before 2b.
2. **Crawl volume / cadence** — how many customers, how often? Drives batching + whether it's incremental (changed-since) vs full.
3. **PII / retention** — sales history + addresses are sensitive; confirm storage/retention is acceptable (APPI).
4. Each prod step (synqed-core migration, SDK publish, deploy) is gated on Anthony — same flow as Part 1.

## Not in this spec
Part 1 (DOB+gender — done, pending merge/publish), Part 3 (AI memory), and the native-app/background-recording question (separate strategic decision: Capacitor wrapper vs external recorder like Plaud).
