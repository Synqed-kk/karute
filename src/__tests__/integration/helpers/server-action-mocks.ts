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
export const TEST_STAFF_PROFILE_ID = '28318e68-6b73-46ed-a1a2-c21299deee3f'

/**
 * REFERENCE: Copy these jest.mock blocks to the top level of your test file.
 *
 * Mock 1: @/lib/staff — provides a fake getCurrentUserStaffId() that returns
 * TEST_STAFF_PROFILE_ID. Server actions read the signed-in user's staff id
 * from this resolver (it derives from auth.uid() in production).
 *
 * ```typescript
 * jest.mock('@/lib/staff', () => ({
 *   getBusinessId: jest.fn(async () => '00000000-0000-0000-0000-000000000001'),
 *   getCurrentUserStaffId: jest.fn(async () => '28318e68-6b73-46ed-a1a2-c21299deee3f'),
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
 * Mock 4: @/lib/supabase/server — redirects server actions to use the test Supabase client.
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
