-- Customer Memory (transitional) — the persistent, accumulating list of durable
-- facts about a customer, extracted from session transcripts after each
-- recording. Powers the pre-session brief's personal talking points (会話の記憶)
-- and the customer-page memory card. Same transitional posture as
-- karute_outcomes: lives in the app's Supabase until synqed-core owns it.
--
-- A "memory item" is a DURABLE fact worth remembering across visits — a pet's
-- name, a child's milestone, a trip, a persistent body pattern, a goal — NOT a
-- one-off treatment note (that belongs on the karute). The AI maintains its own
-- items (source='ai_extraction') via add/update/remove deltas and NEVER touches
-- staff-pinned or intake-form items.

create table if not exists public.customer_memory_items (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null,
  business_id text,
  category text not null
    check (category in ('personal','body','preference','goal','lifestyle')),
  label text not null,
  detail text,
  source text not null default 'ai_extraction'
    check (source in ('ai_extraction','staff','intake_form')),
  confidence real not null default 0.8,
  pinned boolean not null default false,
  suggest_talking_point boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists customer_memory_items_customer_idx
  on public.customer_memory_items (customer_id)
  where deleted_at is null;

-- RLS on; the app reads/writes through the service-role client (business scope
-- enforced in code), same posture as karute_outcomes. No anon/authenticated
-- policies — service role bypasses RLS.
alter table public.customer_memory_items enable row level security;
