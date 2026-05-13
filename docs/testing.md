# Testing

## Test account

Canonical test account for local + preview environments:

- Email: `dev@karute.test`
- Password: `TestPass123!`

Provision (idempotent — creates the user if missing, resets password if exists,
runs business bootstrap once):

```bash
npx tsx --env-file=.env scripts/seed-test-user.ts
```

## Playwright authentication

To avoid walking the `/en/login` form on every test run, save a `storageState`
JSON once and load it on future runs:

```bash
# 1. Make sure the dev server is running on :3000
npm run dev

# 2. Run the helper (saves to .auth/dev-user.json — gitignored)
npx tsx scripts/playwright-login.ts

# 3. In Playwright code, load it:
#    const context = await browser.newContext({ storageState: '.auth/dev-user.json' })
```

Regenerate the state when Supabase rotates sessions (typically every few weeks).
