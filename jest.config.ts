import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

const config: Config = {
  // Use node environment for server-side integration tests (NOT jsdom)
  testEnvironment: 'node',

  // Only match integration test files
  testMatch: ['**/__tests__/integration/**/*.test.ts'],

  // Run global setup after Jest test framework is initialized (has access to beforeAll/afterAll)
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/integration/setup/jest.setup.ts'],

  // Resolve @/* path aliases from tsconfig (next/jest may not auto-detect with moduleResolution: bundler)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // ESM .js extensions inside @synqed-kk/client's transpiled output — strip
    // the suffix so jest's transform resolves the TS source via CJS.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  // Allow jest to transform the @synqed-kk/client ESM package (everything
  // else under node_modules stays untransformed per next/jest defaults)
  transformIgnorePatterns: ['/node_modules/(?!@synqed-kk/)'],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
