-- =====================================================
-- Staff invites
-- =====================================================
-- Backs the owner → staff invite/join flow. An owner creates an invite (email +
-- role) scoped to their business; the invitee opens a tokenized /join link and
-- sets a password; the `acceptInvite` server action then attaches their new auth
-- user to the business SERVER-SIDE (service-role) — never via client metadata
-- (the signup trigger was hardened in 20260603000000 to ignore client customer_id).
--
-- The table is SERVICE-ROLE ONLY: RLS is enabled with NO authenticated policy, so
-- it is unreachable from the anon/authenticated REST surface. All access goes
-- through server actions (src/actions/invites.ts) using the service-role client,
-- which (a) keeps the token secret off the client except in the copy-link the
-- owner shares, and (b) lets the unauthenticated /join page validate a token
-- without a session.
-- =====================================================

create table if not exists invites (
  id          uuid default gen_random_uuid() primary key,
  business_id uuid not null,                         -- the tenant (profiles.customer_id) being joined
  email       text not null,                         -- invitee email; locked into the new auth account
  role        text not null default 'STYLIST'
              check (role in ('ADMIN', 'STYLIST', 'ASSISTANT')),  -- synqed StaffRole, never OWNER
  token       text not null unique,                  -- unguessable capability (server-generated)
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'revoked')),
  invited_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz default now() not null,
  expires_at  timestamptz not null
);

create index if not exists invites_business_id_idx on invites (business_id);
create index if not exists invites_token_idx        on invites (token);
create index if not exists invites_email_idx        on invites (lower(email));

alter table invites enable row level security;
-- No policies on purpose: authenticated/anon roles get zero rows. Service-role
-- (used by the server actions) bypasses RLS. See header.
