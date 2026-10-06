# core-contract

Typed readers for core's C0 contract (build order #1, ticket CORE-59, today-impact C0).

- Tests-only until C2/B1: no door, page, action or API route imports this folder.
- Enforced by an ESLint rule in `eslint.config.mjs` (`no-restricted-imports` on `@/lib/core-contract*`
  and `**/lib/core-contract*`, everywhere under `src/` except `src/__tests__/**` and this folder),
  proven by `src/__tests__/integration/business/c0-door-import-lint.test.ts`.
- `c0.ts` reads over an injected `CoreHttp` port: it never reads env, a URL base or a key.
- The contract of record: build-s22/ORDER-1-C0-S22.final.md + build-s22/RULINGS-ORDER1-S22.md.
