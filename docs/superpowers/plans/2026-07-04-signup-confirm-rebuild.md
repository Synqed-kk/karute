# Signup → Confirm → Bootstrap Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new-account signup complete end-to-end with email confirmation ON — confirm link creates a session and provisions the business server-side.

**Architecture:** Approach A. `signUp` sends an `emailRedirectTo` to a new `/[locale]/auth/callback` route with `salon_name` in user metadata. The callback exchanges the code for a session, then runs the (idempotent, service-role) bootstrap. New middleware refreshes the session on every request and guards `(app)` routes. A sweep script remediates existing ghosts.

**Tech Stack:** Next.js App Router, `@supabase/ssr` ^0.9.0, next-intl, `@synqed-kk/client`, Jest.

## Global Constraints

- Email confirmation stays ON; `signUp` returns **no session**.
- Prod domain: `https://karute-omega.vercel.app`; local dev: `http://localhost:3000`. Redirect base = `NEXT_PUBLIC_SITE_URL`.
- Owner staff `name` = email local-part (`email.split('@')[0]`), never the salon name.
- Bootstrap stays idempotent and service-role; signature `(salonName: string, userId: string)`.
- User-facing auth errors always go through `authErrorKey` → i18n key; never raw Supabase messages.
- Tests: Jest, run with `npx jest <path>`.

---

### Task 1: Fix owner staff name in bootstrap

**Files:**
- Modify: `src/actions/bootstrap.ts:85-90`
- Test: `src/__tests__/integration/bootstrap-owner-name.test.ts`

**Interfaces:**
- Produces: `bootstrapBusinessForNewUser(salonName, userId)` unchanged signature; OWNER staff created with `name = email local-part`.

- [ ] **Step 1: Write failing test** — mock `SynqedClient` + service client; assert `staff.create` called with `name: 'jane'` for email `jane@salon.jp`, not the salon name.
- [ ] **Step 2: Run, verify fail** — `npx jest bootstrap-owner-name` → FAIL (name is salon name).
- [ ] **Step 3: Implement** — in `bootstrap.ts`, derive `const ownerName = (user.email ?? '').split('@')[0] || 'owner'` and pass `name: ownerName` in `staff.create`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `fix(auth): owner staff name = email local-part, not salon name`.

---

### Task 2: `authErrorKey` helper + message keys

**Files:**
- Create: `src/lib/auth/error-key.ts`
- Modify: `messages/ja.json`, `messages/en.json` (auth block)
- Test: `src/__tests__/integration/auth-error-key.test.ts`

**Interfaces:**
- Produces: `authErrorKey(error: unknown): 'error_invalid' | 'emailAlreadyRegistered' | 'error_generic'`

- [ ] **Step 1: Write failing test** — table: `{message:'Invalid login credentials'}`→`error_invalid`; `{message:'User already registered'}`→`emailAlreadyRegistered`; `{status:400,message:'weird'}`→`error_generic`; `null`→`error_generic`.
- [ ] **Step 2: Run, verify fail** (module missing).
- [ ] **Step 3: Implement** helper:

```ts
export function authErrorKey(error: unknown): string {
  const msg = (error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message) : '').toLowerCase()
  if (msg.includes('already registered') || msg.includes('already been registered')) return 'emailAlreadyRegistered'
  if (msg.includes('invalid login') || msg.includes('invalid credentials') || msg.includes('email or password')) return 'error_invalid'
  return 'error_generic'
}
```

- [ ] **Step 4:** Add to both message files under `auth`: `"error_generic": "問題が発生しました。もう一度お試しください。"` / `"error_generic": "Something went wrong. Please try again."`; `"checkEmail": "確認メールを送信しました。メール内のリンクを開いて登録を完了してください。"` / `"checkEmail": "Confirmation email sent. Open the link in it to finish signing up."`; `"confirmError": "確認リンクが無効または期限切れです。もう一度サインアップしてください。"` / EN equivalent.
- [ ] **Step 5: Run, verify pass. Commit** — `feat(auth): authErrorKey mapping + error/checkEmail message keys`.

---

### Task 3: Rebuild signup form (no session, no client bootstrap)

**Files:**
- Modify: `src/components/signup-form.tsx`
- Test: `src/__tests__/integration/signup-form.test.tsx`

**Interfaces:**
- Consumes: `authErrorKey` (Task 2).
- Produces: `signUp` called with `options.emailRedirectTo` + `options.data.salon_name`; renders `checkEmail` on success.

- [ ] **Step 1: Write failing test** — render `<SignupForm>`, submit; assert `supabase.auth.signUp` called with `options.emailRedirectTo` ending `/{locale}/auth/callback` and `options.data.salon_name`; assert `bootstrapBusinessForNewUser` **not** imported/called; assert success renders the `checkEmail` copy and button re-enabled.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — remove `bootstrapBusinessForNewUser` import + call and the `router.push`; change signUp to:

```ts
const redirect = `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/${locale}/auth/callback`
const { data, error: signupError } = await supabase.auth.signUp({
  email, password,
  options: { emailRedirectTo: redirect, data: { salon_name: salonName } },
})
```
Keep the `identities.length === 0` guard (→ `setError(t('emailAlreadyRegistered'))`). On success: `setSent(true); setLoading(false)`. Replace other `setError(signupError.message)` with `setError(t(authErrorKey(signupError)))`. Add a `sent` state that renders `t('checkEmail')` instead of the form.
- [ ] **Step 4: Run, verify pass. Commit** — `feat(auth): signup sends confirm email + shows check-email state, drops client bootstrap`.

---

### Task 4: Auth callback route

**Files:**
- Create: `src/app/[locale]/auth/callback/route.ts`
- Test: `src/__tests__/integration/auth-callback.test.ts`

**Interfaces:**
- Consumes: `createClient` (server), `bootstrapBusinessForNewUser`.
- Produces: `GET(request, { params: { locale } })` → redirect.

- [ ] **Step 1: Write failing test** — mock server client `exchangeCodeForSession` (returns user with `user_metadata.salon_name`) + `bootstrapBusinessForNewUser`; call `GET` with `?code=abc`; assert redirect to `/{locale}/sessions`. Second case: `exchangeCodeForSession` errors → redirect `/{locale}/login?error=confirm`. Third: bootstrap returns `{ok:false}` → `/{locale}/login?error=confirm`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement:**

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { bootstrapBusinessForNewUser } from '@/actions/bootstrap'

export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const fail = NextResponse.redirect(new URL(`/${locale}/login?error=confirm`, url.origin))
  if (!code) return fail
  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) return fail
  const salonName = (data.user.user_metadata?.salon_name as string | undefined) ?? data.user.email ?? 'Salon'
  const result = await bootstrapBusinessForNewUser(salonName, data.user.id)
  if (!result.ok) return fail
  return NextResponse.redirect(new URL(`/${locale}/sessions`, url.origin))
}
```

- [ ] **Step 4: Run, verify pass. Commit** — `feat(auth): confirm callback exchanges code + bootstraps server-side`.

---

### Task 5: Middleware — session refresh + route guard

**Files:**
- Create: `src/middleware.ts`
- Test: `src/__tests__/integration/middleware-auth.test.ts`

**Interfaces:**
- Produces: `middleware(request)` + `config.matcher`.

- [ ] **Step 1: Write failing test** — unauth request to `/ja/dashboard` → redirect `/ja/login`; request to `/ja/login` and `/ja/auth/callback` → pass (no redirect); authed request to `/ja/dashboard` → pass.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** using `createServerClient` with the request/response cookie bridge (Supabase SSR middleware pattern); read `getUser()`; if no user and path is under a locale app route (not `login`/`signup`/`join`/`auth`/marketing root), redirect to `/{locale}/login`. `config.matcher`: `['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)']`.
- [ ] **Step 4: Run, verify pass. Commit** — `feat(auth): middleware refreshes session + guards app routes`.

---

### Task 6: Login form error translation + confirm-error banner

**Files:**
- Modify: `src/components/login-form.tsx:24-26`
- Modify: `src/app/[locale]/login/page.tsx` (read `?error=confirm`)
- Test: `src/__tests__/integration/login-form.test.tsx`

**Interfaces:**
- Consumes: `authErrorKey`, `confirmError` message.

- [ ] **Step 1: Write failing test** — bad login renders `t(authErrorKey(...))` not raw message; page with `searchParams.error='confirm'` renders `t('confirmError')`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `setError(t(authErrorKey(error)))` in login-form; in login page, if `searchParams.error === 'confirm'`, render the `confirmError` banner.
- [ ] **Step 4: Run, verify pass. Commit** — `feat(auth): translate login errors + show confirm-failure banner`.

---

### Task 7: Ghost-account sweep script

**Files:**
- Create: `scripts/sweep-ghost-accounts.ts`
- Test: `src/__tests__/integration/sweep-ghosts.test.ts`

**Interfaces:**
- Consumes: service client (`createServiceClient`), `bootstrapBusinessForNewUser`, `SynqedClient`.
- Produces: `findGhosts(): Promise<Ghost[]>` and `main()` gated on `--fix`.

- [ ] **Step 1: Write failing test** — seed: user A with profile.customer_id + OWNER staff = not ghost; user B with profile but no OWNER staff = ghost; user C no profile.customer_id = ghost. `findGhosts()` returns [B, C]. With `--fix`, `bootstrapBusinessForNewUser` called for each ghost.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — paginate `service.auth.admin.listUsers`; for each user, load `profiles.customer_id`; if missing → ghost; else `new SynqedClient({businessId}).staff.list` and check an OWNER row with `user_id === user.id`; if none → ghost. `--report` prints; `--fix` calls `bootstrapBusinessForNewUser(user.user_metadata.salon_name ?? emailLocalPart, user.id)`.
- [ ] **Step 4: Run, verify pass. Commit** — `feat(auth): ghost-account sweep script (--report/--fix)`.

---

### Task 8: Manual verification + dashboard config

- [ ] Apply dashboard values (Site URL, redirect allowlist, JP email template) per spec.
- [ ] Add `NEXT_PUBLIC_SITE_URL` to Vercel Production + local `.env`.
- [ ] Live test: sign up on a preview/prod → receive email → click → land authed on `/sessions` with business + OWNER staff (name = email local-part).
- [ ] Run `npx tsx scripts/sweep-ghost-accounts.ts --report` against prod; then `--fix`.
- [ ] Commit any config docs.

## Self-Review

- **Spec coverage:** findings 1–5 → Tasks 3,4,5,1,2/6; ghost sweep → Task 7; dashboard → Task 8. Covered.
- **Placeholder scan:** none.
- **Type consistency:** `bootstrapBusinessForNewUser(salonName, userId)` and `authErrorKey(error)` consistent across tasks.
