# core-contract

Typed readers for core's C0 contract (build order #1, ticket CORE-59, today-impact C0).

- Tests-only until C2/B1: no door, page, action or API route imports this folder.
- Enforced by ESLint in `eslint.config.mjs`, on every `src/**/*.{ts,tsx,js,jsx,mjs,cjs}` outside `src/__tests__/**` and this
  folder: `no-restricted-imports` (`@/lib/core-contract`, `**/core-contract` — static imports, `export … from`, relative
  paths) and `no-restricted-syntax` (`import('…core-contract…')`, `require('…core-contract…')`).
- Tests may import and re-export the reader (src/__tests__ is outside the rule); a door must not import a test file.
- This folder holds exactly `c0.ts` and this README (a test fails on any other file, so no door helper can hide here).
- One rule for envelopes: strict both ways — any extra or missing key on the overlap list envelope or the switches
  envelope (and any extra or missing switch key) is a `SHAPE` error; a later additive key needs a reader change first.
- `c0.ts` reads over an injected `CoreHttp` port: it never reads env, a URL base or a key.
- The contract of record: build-s22/ORDER-1-C0-S22.final.md + build-s22/RULINGS-ORDER1-S22.md.
