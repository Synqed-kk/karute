/**
 * Global Jest setup for integration tests.
 * Runs after the test framework is initialized (has access to beforeAll/afterAll).
 * Configured via setupFilesAfterEnv in jest.config.ts.
 */

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
