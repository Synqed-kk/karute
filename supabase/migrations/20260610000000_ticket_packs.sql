-- 回数券 (ticket-pack) management — the domain Kitano's manual 顧客管理 sheet
-- tracks by hand today: which pack a customer bought (3/6/10/20/50回 or サブスク),
-- what each session is worth, how many remain, and the prepaid-but-unconsumed
-- balance (~¥8.7M across 219 customers at import time). Feeds the 離客 alerts
-- ("pack holder, no next booking, N+ days unseen") on the dashboard.
--
-- TRANSITIONAL home (Karute-side) so the feature works from day one; durable
-- home is synqed-core (single source of truth). The app talks to these tables
-- only through src/lib/packs/store.ts — when synqed gains the model, the
-- backing migrates with zero UI change. synqed ids stay opaque text.

-- 1. The purchase record. One row per pack a customer bought.
create table if not exists public.ticket_packs (
  id             uuid primary key default gen_random_uuid(),
  customer_id    text not null,                  -- synqed customer id (tenant scope)
  -- pack: counted sessions; subscription: monthly サブスク; single: 単発 one-off.
  kind           text not null default 'pack' check (kind in ('pack', 'subscription', 'single')),
  pack_size      integer not null check (pack_size > 0),         -- 3/6/10/20/50…
  unit_price     integer not null default 0 check (unit_price >= 0),  -- 消化単価 (yen)
  total_price    integer,                        -- paid amount (yen); null = size×unit
  -- 追加数 on the sheet: 0 = 初回, 1 = 1回目(first repurchase), 2 = 2回目…
  purchase_round integer not null default 0 check (purchase_round >= 0),
  purchased_at   date,
  -- Where the record came from. 'manual' = staff entry in Karute; 'import' =
  -- the one-time Kitano-sheet backfill; 'qr'/'pos' reserved for future feeds.
  source         text not null default 'manual' check (source in ('manual', 'import', 'qr', 'pos')),
  status         text not null default 'active' check (status in ('active', 'exhausted', 'cancelled')),
  notes          text,
  created_by     text,                           -- staff profile id
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists ticket_packs_customer_idx
  on public.ticket_packs (customer_id, status);

-- 2. The consumption ledger. One row per session checked off a pack — NOT
--    derived from raw visit counts, because trial visits (新規コース) and
--    subscription visits don't consume pack sessions. remaining =
--    pack_size − count(redemptions). Optionally linked to the visit.
create table if not exists public.pack_redemptions (
  id              uuid primary key default gen_random_uuid(),
  pack_id         uuid not null references public.ticket_packs (id) on delete cascade,
  customer_id     text not null,                 -- denormalized for tenant queries
  redeemed_on     date not null,
  appointment_id  text,                          -- synqed appointment (when known)
  karute_record_id text,                         -- synqed karute (when known)
  source          text not null default 'manual' check (source in ('manual', 'import', 'qr', 'pos')),
  created_by      text,
  created_at      timestamptz not null default now()
);

create index if not exists pack_redemptions_pack_idx
  on public.pack_redemptions (pack_id);
create index if not exists pack_redemptions_customer_idx
  on public.pack_redemptions (customer_id, redeemed_on);

-- 3. Lifecycle status — the sheet's 卒業/離客 marks + 口コミ flag. Separate
--    table (synqed-core's Prisma owns `customers`; adding columns there would
--    drift the schema). One row per customer, upserted.
create table if not exists public.customer_lifecycle (
  customer_id  text primary key,
  status       text not null default 'active' check (status in ('active', 'graduated', 'lost')),
  referral     boolean not null default false,   -- 口コミ
  updated_by   text,
  updated_at   timestamptz not null default now()
);

-- 4. Alert dismissals — manager-only "stop alerting for this customer" with an
--    audit trail (who/when/why). The alert list excludes customers with an
--    active dismissal; consumed by P3.
create table if not exists public.pack_alert_dismissals (
  id           uuid primary key default gen_random_uuid(),
  customer_id  text not null,
  dismissed_by text not null,                    -- staff profile id (manager)
  reason       text,
  -- A dismissal auto-expires when the customer visits again (cleared by the
  -- app) or when this passes; null = until next visit.
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists pack_alert_dismissals_customer_idx
  on public.pack_alert_dismissals (customer_id, created_at desc);

-- All access is server-side via the service-role client (auth + tenant are
-- enforced in the server actions). Enable RLS with no public policies so no
-- browser client can reach these directly.
alter table public.ticket_packs enable row level security;
alter table public.pack_redemptions enable row level security;
alter table public.customer_lifecycle enable row level security;
alter table public.pack_alert_dismissals enable row level security;
