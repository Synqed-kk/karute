# Staff Login & Roles — Go-Live Runbook

Makes owner→staff logins + role-based permissions **live**. All code is in three
stacked, Greptile-reviewed PRs: **#157 → #158 → #159** (merge in that order).
Order matters; #157 is a security prerequisite.

> Author note: I built + verified these at the code level (tsc, lint, unit tests)
> but **cannot reach the prod DB** from the dev environment — hence this runbook
> rather than a self-applied change. Steps 1–2 are yours, Anthony.

## Sequence (TL;DR)
1. Merge the stack **#157 → #158 → #159** into `incremental-merge` (in order).
2. Apply the **3 migrations to prod, in order** (your usual `supabase db push` / dashboard).
3. Confirm synqed-core `staff.create` accepts `role` on the deployed (0.12.0) client.
4. Flip **`NEXT_PUBLIC_FEATURE_STAFF_INVITES=true`** in Vercel (Production).
5. Smoke-test end-to-end.

## 1 · The migrations (apply IN ORDER)
| # | File | What it does | Pre-check |
|---|------|--------------|-----------|
| 1 | `20260603000000_tenant_isolation_hardening.sql` | profiles RLS → same-business; blocks the `customer_id` tenant-pivot; hardens the signup trigger (ignores client `customer_id`, pinned `search_path`) | `select * from pg_policies where tablename='profiles';` — confirm it's still `using(true)` (the hole). If prod was already tightened in the dashboard, reconcile before applying. |
| 2 | `20260603010000_staff_invites.sql` | `invites` table (service-role-only RLS) | — |
| 3 | `20260603020000_staff_permissions.sql` | `profiles.permission_role` + `permissions jsonb`, backfilled from `display_role` | — |

⚠️ **#1 first** — it's the cross-tenant isolation fix everything else assumes. Without it, multi-staff makes the existing hole exploitable.

## 2 · Verify (post-apply)
- **Isolation (#1):** an owner still loads roster/customers/karute; `update profiles set customer_id='<other-biz>' where id = auth.uid()` via the anon REST API is now **rejected**; a fresh signup still gets its own business.
- **Permissions (#3):** `select id, display_role, permission_role from profiles limit 5;` — `permission_role` backfilled (owner→`owner`, admin→`manager`, assistant→`frontdesk`, else `practitioner`). Effective access unchanged until someone is explicitly customized.
- **Invites (#2):** `select count(*) from invites;` → table exists, RLS on, anon/authenticated get zero rows.

## 3 · synqed-core
`acceptInvite` + `createStaff` call `synqed.staff.create({ …, role })`. The installed 0.8.0 dts exposes `StaffRole`, and `bootstrap.ts` already sets `role: 'OWNER'`, so 0.12.0 should accept it — just confirm `CreateStaffInput` includes `role` on the deployed core.

## 4 · Flag
Only **after #1–3 are applied + verified**, set `NEXT_PUBLIC_FEATURE_STAFF_INVITES=true` (Vercel → Production). This reveals Settings→Staff "Invite staff" and enables `/join`. (Leaving it off = everything stays dark, zero user impact — that's the safe default until the migrations land.)

## 5 · End-to-end smoke
Owner → Settings → Staff → **Invite staff** → email + role → copy link → open incognito → set name + password → should land in the **owner's** store and appear on the roster. Role gates: a non-owner can't open billing and can't delete staff.

## Rollback
- **Flag off** → instant, full revert of the user-facing feature.
- **#2 / #3** are additive — drop the `invites` table / the two `profiles` columns to undo.
- **#1 is the security fix — do NOT roll it back to `using(true)`.** If it ever causes a lockout, fix-forward by adjusting the policy, not by reopening the hole.
