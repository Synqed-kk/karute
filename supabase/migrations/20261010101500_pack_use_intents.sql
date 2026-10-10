-- =====================================================
-- pack_use_intents — the ticket-use ledger (消化の控え), design v4.2 § 2
-- =====================================================
-- One row = one staff GESTURE to use (or undo) a 回数券 session, written BEFORE
-- core is asked (R1). The row id IS the Idempotency-Key core sees. This is NOT a
-- shadow of core's pack tables: it records gestures, and it must live where
-- Karute can write while core cannot answer (Liam R-S125-7, 2026-10-10:
-- 「put the table in Karute's own database」).
--
-- Plain table: no triggers, no functions. Nothing is ever deleted (⚖ 9/16):
-- states are soft (withdrawn, undone_by, staff_resolution). No retention.
-- SERVER-SIDE ONLY: RLS enabled with NO policy (same shape as
-- business_workspace_grants); the service role is the only reader and writer,
-- so the app code refuses a key whose stored business differs (§ 2, N4).
-- Core ids (customer/pack/appointment/redemption) are text: they are core-owned
-- and never joined here.
-- =====================================================

create table if not exists pack_use_intents (
  id                    text not null,   -- = the Idempotency-Key exactly as the client sent it
  business_id           uuid not null,
  owner_user_id         uuid,
  kind                  text not null check (kind in ('use', 'undo')),
  ledger_source         text not null check (ledger_source in ('manual', 'no_show', 'cancel', 'recovery', 'backfill', 'auto')),
  core_source           text not null check (core_source in ('manual', 'backfill', 'auto')),
  customer_id           text not null,
  pack_id               text,
  pack_picked_by        text not null check (pack_picked_by in ('staff', 'system')),
  appointment_id        text,
  appointment_resolved  boolean not null default true,
  gesture_at            timestamptz not null,
  gesture_at_client     timestamptz,
  clock_suspect         boolean not null default false,
  redeemed_on           date not null,
  counts_as_visit       boolean,
  another_session       boolean not null default false,
  target_redemption_id  text,
  frozen_payload        jsonb,
  repick_payload        jsonb,          -- R3-pick: the body sent after a system re-pick; frozen_payload is never rewritten
  repicked_from         text,
  audit_payload         jsonb,
  created_at            timestamptz not null default now(),
  state                 text not null check (state in ('held', 'pending', 'parked', 'settled', 'refused', 'withdrawn')),
  attempts              integer not null default 0,
  last_attempt_at       timestamptz,
  leased_until          timestamptz,
  last_error_code       text,
  last_error_status     integer,
  last_error_text       text,
  settled_core_id       text,
  settled_at            timestamptz,
  refused_at            timestamptz,
  refused_code          text,
  parked_at             timestamptz,
  parked_reason         text,
  resumed_at            timestamptz,
  held_at               timestamptz,
  held_against          text,
  withdraw_requested_at timestamptz,
  withdrawn_at          timestamptz,
  withdrawn_by          text,
  resolved_by           text,
  staff_resolution      text check (staff_resolution in ('other_pack', 'collected', 'dismissed')),
  staff_resolved_by     text,
  staff_resolved_at     timestamptz,
  last_alarmed_at       timestamptz,
  undone_by             text,
  constraint pack_use_intents_business_id_unique unique (business_id, id)
);

-- the settle pass + the dead-man (H10)
create index if not exists pack_use_intents_open_idx
  on pack_use_intents (state, business_id, created_at)
  where state in ('held', 'pending', 'parked');

-- the card read + the gate (H10, H13)
create index if not exists pack_use_intents_customer_open_idx
  on pack_use_intents (business_id, customer_id)
  where state in ('held', 'pending', 'parked', 'refused') and staff_resolution is null;

-- one intent claims one core row (G10); a violation = re-read and continue
create unique index if not exists pack_use_intents_settled_core_unique
  on pack_use_intents (business_id, settled_core_id)
  where settled_core_id is not null;

alter table pack_use_intents enable row level security;
