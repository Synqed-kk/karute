/**
 * Server action mock patterns for integration tests.
 *
 * jest.mock() calls MUST be at the TOP LEVEL of test files (not inside describe/beforeAll).
 * Jest hoists jest.mock() to the top of the file regardless of placement.
 *
 * Copy the mock blocks below into your test file. They cannot be called as functions
 * because jest.mock() is hoisted at compile time, not runtime.
 */

import { testSupabase } from './supabase'

/**
 * The staff profile ID used by server action mocks.
 * This profile must be created in the test DB via createTestProfile() before tests run.
 */
export const TEST_STAFF_PROFILE_ID = '00000000-test-0000-0000-000000000001'

/**
 * REFERENCE: Copy these jest.mock blocks to the top level of your test file.
 *
 * Mock 1: next/headers — provides a fake cookies() that returns TEST_STAFF_PROFILE_ID
 * for 'active_staff_id'. This is how server actions read the active staff member.
 *
 * ```typescript
 * jest.mock('next/headers', () => ({
 *   cookies: jest.fn(() => ({
 *     get: jest.fn((name: string) => {
 *       if (name === 'active_staff_id') return { value: '00000000-test-0000-0000-000000000001' }
 *       return undefined
 *     }),
 *     getAll: jest.fn(() => []),
 *     set: jest.fn(),
 *   })),
 * }))
 * ```
 *
 * Mock 2: next/cache — prevents revalidatePath from throwing in test environment
 *
 * ```typescript
 * jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
 * ```
 *
 * Mock 3: next/navigation — prevents redirect() from throwing in test environment
 *
 * ```typescript
 * jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
 * ```
 *
 * Mock 4: @/lib/supabase/server — redirects server actions to use test Supabase client.
 * This also covers transitive dependencies like checkDuplicateName in customers/queries.ts.
 *
 * ```typescript
 * jest.mock('@/lib/supabase/server', () => ({
 *   createClient: jest.fn(() => Promise.resolve(testSupabase)),
 * }))
 * ```
 * where testSupabase is imported from './helpers/supabase'
 */

// Export testSupabase reference for use in mock factory closures
export { testSupabase }
