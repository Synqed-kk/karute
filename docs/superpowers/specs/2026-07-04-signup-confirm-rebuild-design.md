# Signup → Confirm → Bootstrap Rebuild

**Date:** 2026-07-04
**Status:** Approved (Approach A)

## Problem

New-account signup cannot complete. Email confirmation is ON in Supabase, so
`supabase.auth.signUp()` returns a **user but no session**. The current flow
assumes a session exists: it bootstraps client-side immediately and redirects to
an app route. Confirmed users end up as "ghosts" (auth user + default profile,
no business, no OWNER staff) and stay logged out.

### Verified audit findings (all confirmed against code)

1. `signUp({ email, password })` — no `options`, no `emailRedirectTo`, no
   metadata (`src/components/signup-form.tsx:40`). Confirm emails fall back to
   Supabase Site URL (still `localhost:3000`).
2. No auth callback route anywhere; zero `exchangeCodeForSession`; no
   `middleware.ts`. The `?code=` from the confirm link lands on the marketing
   page and dies.
3. Bootstrap (`src/actions/bootstrap.ts`) is invoked client-side right after
   `signUp` (`signup-form.tsx:60`). Side bug: OWNER `staff.create` stores the
   salon name as the person's name (`bootstrap.ts:85-90`).
4. Success path never resets loading (`signup-form.tsx:64-66`) — button hangs on
   アカウント作成中.
5. Raw Supabase error messages shown to users (`signup-form.tsx:40`,
   `login-form.tsx:25`). `auth.error_invalid` key exists but is referenced
   nowhere.

### Existing foundation (reuse, don't rebuild)

- `@supabase/ssr` ^0.9.0 installed. Browser client (`lib/supabase/client.ts`),
  server client (`lib/supabase/server.ts`), service client
  (`lib/supabase/service.ts`) all present.
- `server.ts:22` comment already says *"middleware handles refresh"* — the
  middleware it refers to does not exist. This is the gap.
- i18n `auth` namespace exists in `messages/{ja,en}.json` with `error_invalid`
  and `emailAlreadyRegistered`.
- App routes under `src/app/[locale]/`: `(app)/`, `login/`, `signup/`, `join/`,
  marketing `page.tsx`.

## Decisions

- **Approach A**: the callback route handler exchanges the code for a session,
  then runs bootstrap inline, then redirects. Ghost-sweep script covers any that
  slip through; no per-request provisioning check.
- **Owner staff name** = email local-part (`email.split('@')[0]`). Salon name
  stays the business/profile identity. User renames in settings later.
- **Ghost sweep** = detect + remediate script.
- **Dashboard config** = user applies values in the Supabase dashboard; this
  spec supplies exact values.
- **Post-signup UX** = a "確認メールを送信しました" screen (no auto-redirect), since
  there is no session to redirect with.

## Components

### 1. `src/components/signup-form.tsx`
- `signUp({ email, password, options: { emailRedirectTo, data: { salon_name } } })`
  where `emailRedirectTo = ${NEXT_PUBLIC_SITE_URL}/${locale}/auth/callback`.
- **Remove** the client-side `bootstrapBusinessForNewUser` import + call.
- Keep the `identities.length === 0` already-registered guard.
- On success: set a `sent` state → render "確認メールを送信しました" (`checkEmail`
  message); reset `loading` on every exit path.
- Errors go through `authErrorKey` (component 5).

### 2. `src/app/[locale]/auth/callback/route.ts` (new)
- `GET` handler. Reads `code` from search params and `locale` from the path.
- Server client `exchangeCodeForSession(code)` — sets session cookies.
- On success: read `salon_name` from `user.user_metadata`, call
  `bootstrapBusinessForNewUser(salon_name, user.id)`.
- Redirect to `/${locale}/sessions` on success; to
  `/${locale}/login?error=confirm` on any failure (bad/expired code, bootstrap
  error). Never render; always redirect.

### 3. `src/middleware.ts` (new)
- Supabase SSR session-refresh on every matched request (createServerClient with
  request/response cookie bridge) — the missing refresh `server.ts:22` expects.
- Guard: unauthenticated requests to `(app)` routes redirect to
  `/${locale}/login`. `login`, `signup`, `join`, marketing, and `auth/callback`
  stay public.
- `matcher` excludes `_next/static`, `_next/image`, favicon, and other static
  assets.

### 4. `src/actions/bootstrap.ts`
- Single change: OWNER `staff.create({ name })` uses email local-part instead of
  `salonName`. Everything else (idempotency, service-role `getUserById`, profile
  ensure) unchanged.
- Signature unchanged (`salonName`, `userId`) so the callback and sweep script
  share it.

### 5. Error translation
- New helper `src/lib/auth/error-key.ts`: `authErrorKey(error): string` maps
  Supabase auth error messages/status to i18n keys:
  - invalid credentials / bad login → `error_invalid`
  - already registered → `emailAlreadyRegistered`
  - anything else → `error_generic`
- Wire into `signup-form.tsx` and `login-form.tsx` (replaces raw
  `error.message`).
- Add message keys to `messages/{ja,en}.json`: `error_generic`, `checkEmail`.
  Also add `confirmError` used by the login page when `?error=confirm`.

### 6. `scripts/sweep-ghost-accounts.ts` (new)
- Lists `auth.users` via service-role admin API (paginated).
- For each: ghost if `profiles.customer_id` missing OR no synqed OWNER staff
  with `user_id === user.id`.
- `--report` (default): prints the ghost list (id, email, what's missing).
- `--fix`: re-runs `bootstrapBusinessForNewUser` for each ghost, using
  `user_metadata.salon_name` when present else email local-part as salon name.
- Idempotent; safe to re-run.

## Dashboard values (user applies)

- **Site URL** → `${PROD_DOMAIN}` — *user to confirm exact prod domain*
  (candidate: `app.synqed.jp` / `karute.synqed.jp`).
- **Additional Redirect URLs** → `${PROD_DOMAIN}/*/auth/callback`
- **Confirm-email template** → Japanese branded HTML (supplied at implementation
  time).
- **Env** → add `NEXT_PUBLIC_SITE_URL=${PROD_DOMAIN}` to Vercel + `.env`.

## Testing (TDD)

- `bootstrap` owner-name unit: name = email local-part, not salon name.
- `authErrorKey` mapping table: each Supabase error → expected key.
- callback route handler: code→session→bootstrap→redirect happy path; bad code →
  login?error=confirm; bootstrap throw → login?error=confirm.
- middleware: unauth `(app)` → login; authed passes; public routes pass.
- sweep script: seeded ghost detected by `--report`; `--fix` provisions it and a
  re-run reports zero.

## Out of scope

- One-burn redemption guard, refund path (separate work).
- Renaming `profiles.full_name` semantics.
- Automated dashboard config (auth Site URL / templates applied by hand).
