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

## Jest integration suite — "random suite fails, passes on rerun"

If a full parallel run (`npx jest src/__tests__/integration/`) fails ONE suite with:

```
● Test suite failed to run
  A jest worker process (pid=…) was terminated by another process: signal=SIGSEGV
```

that is **not a test failure** — a jest worker's Node process crashed inside
V8's garbage collector and jest blames whichever test file was assigned to the
dead worker (a different suite each time; always green in isolation).

Diagnosis: check for a matching macOS crash report —

```bash
ls -t ~/Library/Logs/DiagnosticReports/node-*.ips | head -3
```

A report whose faulting stack starts with
`v8::internal::ClearStaleLeftTrimmedPointerVisitor::VisitRootPointers` during
`MarkCompactCollector` confirms the runtime crash (observed June 2026 on the
Node 24.12.0 macOS `.pkg` build).

Fix: update Node within the version pinned by `.nvmrc` (≥ 24.16) and run tests
on that runtime. Do **not** add `--runInBand`, retries, or suite skips — they
mask runtime crashes as test-level noise. If it recurs on a current Node, keep
the `.ips` file and report it upstream (nodejs/node) with the stack.
