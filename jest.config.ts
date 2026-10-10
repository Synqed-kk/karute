import type { Config } from 'jest'
import nextJest from 'next/jest.js'

// Vercel and CI both run UTC; a Japanese developer's Mac runs JST. Several
// suites pin a JST weekday or a JST day boundary, and under a JST runtime the
// BUGGY spelling (date.getDay(), a raw getDate()) agrees with the fixed one —
// so those regression tests silently stop discriminating locally and only CI
// catches a revert (L1 F2). Set here, in the parent process, before any worker
// forks: workers inherit process.env, while assigning TZ inside a test file is
// a no-op under jest's worker sandbox (calendar-range.test.ts documents that).
process.env.TZ = 'UTC'
// use-ledger.ts cutoverDay() has no fallback outside tests (S126 hole 5): this fixed day is the
// default for every suite; an operator's exported value (the live proof under jest) wins. Empty counts
// as unset — `??=` would keep '' and cutoverDay() would return null, turning every ledger test pending.
if (!process.env.KARUTE_LEDGER_CUTOVER_DAY?.trim()) process.env.KARUTE_LEDGER_CUTOVER_DAY = '2026-10-11'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

const config: Config = {
  // Use node environment for server-side integration tests (NOT jsdom)
  testEnvironment: 'node',

  // Match integration test files. `.tsx` is included so component render
  // tests (React Testing Library, jsdom via per-file @jest-environment) are
  // collected alongside the node-environment server-side tests.
  testMatch: ['**/__tests__/integration/**/*.test.ts', '**/__tests__/integration/**/*.test.tsx'],

  // Run global setup after Jest test framework is initialized (has access to beforeAll/afterAll)
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/integration/setup/jest.setup.ts'],

  // Resolve @/* path aliases from tsconfig (next/jest may not auto-detect with moduleResolution: bundler)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // ESM .js extensions inside @synqed-kk/client's transpiled output — strip
    // the suffix so jest's transform resolves the TS source via CJS.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  // Allow jest to transform ESM-only deps (everything else under node_modules
  // stays untransformed per next/jest defaults):
  //  - @synqed-kk/client — transpiled ESM output
  //  - zod (v4) — ships ESM that jest can't parse raw
  //  - next-intl / use-intl — ESM-only ("Unexpected token 'export'") once
  //    imported transitively for real (e.g. getTranslations via
  //    src/actions/customers.ts in migrated-core-flow.test.ts)
  transformIgnorePatterns: ['/node_modules/(?!(@synqed-kk|zod|next-intl|use-intl)/)'],
}

// next/jest PREPENDS its own '/node_modules/(?!.pnpm)(?!(geist|next/…)/)' ignore
// entry, and a file is ignored when ANY pattern matches, so the allow-list above
// never took effect: the real @synqed-kk/client could not load (S126 F12,
// 「Unexpected token 'export'」). Add a (?!@synqed-kk/) lookahead to that one
// entry; every other entry stays as next/jest builds it.
// createJestConfig is async so next/jest can load the Next.js config.
const withNext = createJestConfig(config)
export default async (): Promise<Config> => {
  const c = await withNext()
  const lets = (p: string) => (p.startsWith('/node_modules/') && !p.includes('@synqed-kk') ? `/node_modules/(?!@synqed-kk/)${p.slice('/node_modules/'.length)}` : p)
  return { ...c, transformIgnorePatterns: (c.transformIgnorePatterns ?? []).map(lets) }
}
