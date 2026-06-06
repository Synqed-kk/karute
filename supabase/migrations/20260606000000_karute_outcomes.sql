-- Session outcomes — the AI-coaching TRAINING-DATA label for each recorded
-- session (成約 / 不成約+理由 / 後で決める). This is the moat: every session
-- becomes a labeled example for coaching pattern extraction.
--
-- TRANSITIONAL home (Karute-side) so labeled data accrues from day one; the
-- durable home is synqed-core's KaruteRecord (single source of truth). The
-- app talks to it only through setKaruteOutcome() — when synqed gains the
-- fields, the backing migrates with zero UI change. See
-- docs/karute-session-outcome-spec.md. Keyed by the synqed karute_record_id.

create table if not exists public.karute_outcomes (
  id               uuid primary key default gen_random_uuid(),
  -- synqed ids are opaque strings; keep as text to avoid uuid-cast coupling.
  customer_id      text not null,                 -- tenant scope
  karute_record_id text not null unique,          -- one outcome per session
  outcome          text not null check (outcome in ('success', 'no_deal', 'pending')),
  reason           text check (reason in ('budget', 'considering', 'mismatch', 'follow_up', 'other')),
  is_first_visit   boolean not null default false,
  decided_by       text,                          -- staff profile id (null when auto)
  decided_at       timestamptz,
  auto_decided     boolean not null default false, -- true if the 14-day cron flipped pending→no_deal
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists karute_outcomes_customer_idx
  on public.karute_outcomes (customer_id);

-- The 14-day auto-decide cron scans only un-decided pending rows.
create index if not exists karute_outcomes_pending_idx
  on public.karute_outcomes (created_at)
  where outcome = 'pending';

-- All access is server-side via the service-role client (auth + tenant are
-- enforced in the server action). Enable RLS with no public policies so no
-- client can reach it directly.
alter table public.karute_outcomes enable row level security;
