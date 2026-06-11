-- customer_contacts — the win-back outreach log. Every contact attempt staff
-- make when the 離客アラート fires (who, when, channel, note). This is the
-- OUTCOME stream the future AI coaching trains on ("which contact pattern
-- brings a lapsed pack-holder back") and the owner's staff-effectiveness
-- metric (対応 N件 → 再来店 M件). Impossible to backfill — once a call is made
-- and unrecorded, it's gone.
--
-- Immediate consumer: the 連絡済み workflow on the dashboard alert card
-- (approved design #3). Same service-role posture as its siblings.

create table if not exists public.customer_contacts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  text not null,                    -- synqed customer id
  channel      text not null check (channel in ('phone', 'sms', 'email', 'line', 'in_person')),
  alert_kind   text,                             -- e.g. 'pack_contact' when triggered by the 離客 alert
  note         text,
  contacted_by text not null,                    -- staff profile id
  contacted_at timestamptz not null default now()
);

create index if not exists customer_contacts_customer_idx
  on public.customer_contacts (customer_id, contacted_at desc);

-- Server-side only via the service-role client (same as siblings).
alter table public.customer_contacts enable row level security;
