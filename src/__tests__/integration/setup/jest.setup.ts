/**
 * Global Jest setup for integration tests.
 * Runs after the test framework is initialized (has access to beforeAll/afterAll).
 * Configured via setupFilesAfterEnv in jest.config.ts.
 */

// DOM matchers (toBeInTheDocument, etc.) for jsdom component render tests.
// Harmless to register in node-environment suites — only used by .tsx tests.
import '@testing-library/jest-dom'
import { randomUUID } from 'node:crypto'

// jsdom's Crypto ships getRandomValues and nothing else, so `crypto.randomUUID`
// is undefined in every .tsx / jsdom suite — while every browser this app runs
// in (and the WKWebView shell) has had it for years. That gap is not neutral
// any more: a take id that is not a uuid can never be secured (the key grammar
// refuses it), so without this the recorder's own no-uuid fallback becomes the
// TEST norm and hides the real path. Node's implementation stands in.
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: randomUUID,
    configurable: true,
  })
}

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const

// Validate required env vars exist
for (const envVar of REQUIRED_ENV_VARS) {
  if (!process.env[envVar]) {
    throw new Error(
      `Missing required env var: ${envVar}\n` +
        'Copy .env.test.local.example to .env.test.local and fill in your TEST project values.'
    )
  }
}

// CI has no OpenAI secret, and src/lib/openai.ts constructs its client at
// module load — importing it without a key throws (broke main CI at #486
// once the phase-2 AI-core extractions pulled it into unmocked suites).
// Calls are mocked/caught in tests; the dummy only satisfies the
// constructor. `??=` keeps a real local key when one is set.
process.env.OPENAI_API_KEY ??= 'dummy-not-a-key'

// Guard against accidentally pointing at production
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
if (
  supabaseUrl.includes('prod') ||
  supabaseUrl.toLowerCase().includes('production')
) {
  throw new Error(
    'DANGER: NEXT_PUBLIC_SUPABASE_URL appears to point at production. Use a test project.'
  )
}

// eslint-disable-next-line no-console
console.log('Integration test environment ready')
console.log(`  Supabase URL: ${supabaseUrl}`)
