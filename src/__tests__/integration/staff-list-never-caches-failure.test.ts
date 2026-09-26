/**
 * Round 2 (2026-09-24, D-S16-4, discussed, default) — C3a: NEVER CACHE A
 * FAILURE; AN OUTAGE IS NEVER AN EMPTY ROSTER.
 *
 * The S15 breaker's throwaway reproduction (evidence/S15-BREAKER-C.md,
 * appendix C, `zz-breaker-c3.test.ts`) with its expectations INVERTED. It
 * showed one transient profiles error resolving `[]` INSIDE unstable_cache, so
 * the empty roster was served again after the database recovered — every staff
 * id null, the web door locked for up to 24 h.
 *
 * The stand-in for next's unstable_cache below memoizes exactly what the real
 * one does (next/dist/server/web/spec-extension/unstable-cache.js: the cache
 * write runs after the callback RESOLVES; a rejection propagates before it).
 */
const memo = new Map<string, unknown>()
jest.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => Promise<unknown>, keyParts: string[]) =>
    async (...args: unknown[]) => {
      const k = JSON.stringify([keyParts, args])
      if (memo.has(k)) return memo.get(k)
      const v = await fn(...args) // a rejection is NOT stored
      memo.set(k, v)
      return v
    },
}))
// React's cache() is per-request in RSC; force the no-op so each call re-reads.
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  cache: (fn: (...a: unknown[]) => unknown) => fn,
}))

// The core roster read (profile-less teammates): healthy unless told to fail.
const core = { errorsLeft: 0 }
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    staff = {
      list: async () => {
        if (core.errorsLeft > 0) {
          core.errorsLeft--
          throw new Error('core roster timeout')
        }
        return { staff: [] }
      },
    }
  },
  SynqedError: class extends Error {},
}))

const auth = { user: { id: 'u1' } as { id: string } | null }
jest.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: auth.user } }),
    },
  }),
}))

// Scripted service client: the membership row (getBusinessId) and the roster.
const db = { rosterErrorsLeft: 0, roster: [{ id: 'u1' }] as { id: string }[] }
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.not = () => b
      b.single = async () => ({ data: { customer_id: 'b1', full_name: 'スタッフ' }, error: null })
      b.order = async () => {
        if (db.rosterErrorsLeft > 0) {
          db.rosterErrorsLeft--
          return { data: null, error: { message: 'upstream timeout' } }
        }
        return {
          data: db.roster.map((r) => ({ ...r, full_name: 'スタッフ', created_at: 'x', pin_hash: null, customer_id: 'b1' })),
          error: null,
        }
      }
      return b
    },
  }),
}))

import { getCurrentUserStaffId, getStaffList, staffListByBusiness } from '@/lib/staff'

const ENV = { url: process.env.SYNQED_CORE_URL, key: process.env.SYNQED_CORE_API_KEY }

beforeEach(() => {
  memo.clear()
  core.errorsLeft = 0
  db.rosterErrorsLeft = 0
  db.roster = [{ id: 'u1' }]
  auth.user = { id: 'u1' }
  process.env.SYNQED_CORE_URL = 'http://core.test'
  process.env.SYNQED_CORE_API_KEY = 'test-key'
})

afterAll(() => {
  process.env.SYNQED_CORE_URL = ENV.url
  process.env.SYNQED_CORE_API_KEY = ENV.key
})

describe('C3a inverted — a failed roster read is never cached, never []', () => {
  it('one transient PROFILES error → the first getStaffList() REJECTS; after recovery the real roster (nothing cached)', async () => {
    db.rosterErrorsLeft = 1
    await expect(getStaffList()).rejects.toThrow('staff profiles read failed')
    const second = await getStaffList() // DB healthy now
    expect(second.map((s) => s.id)).toEqual(['u1'])
    expect(db.rosterErrorsLeft).toBe(0)
  })

  it('one transient CORE roster error → rejects too (never a silent profiles-only roster); then recovers', async () => {
    core.errorsLeft = 1
    await expect(getStaffList()).rejects.toMatchObject({
      name: 'AppApiError',
      code: 'upstream_unavailable',
      message: 'synqed-core roster fetch failed',
      cause: { message: 'core roster timeout' },
    })
    expect((await getStaffList()).map((s) => s.id)).toEqual(['u1'])
  })

  it('a SUCCESS is still cached (the cache is not simply off)', async () => {
    expect((await staffListByBusiness('b1')).map((s) => s.id)).toEqual(['u1'])
    db.rosterErrorsLeft = 1 // would fail — but the resolved roster is served
    expect((await staffListByBusiness('b1')).map((s) => s.id)).toEqual(['u1'])
    expect(db.rosterErrorsLeft).toBe(1)
  })
})

describe('getCurrentUserStaffId — null means "not on the roster", never "outage"', () => {
  it('a roster OUTAGE → rejects (shown as an outage, never as removed)', async () => {
    db.rosterErrorsLeft = 1
    await expect(getCurrentUserStaffId()).rejects.toThrow('staff profiles read failed')
  })

  it('a live session the roster does not contain → null', async () => {
    db.roster = [{ id: 'someone-else' }]
    await expect(getCurrentUserStaffId()).resolves.toBeNull()
  })

  it('no session → null', async () => {
    auth.user = null
    await expect(getCurrentUserStaffId()).resolves.toBeNull()
  })

  it('control: on the roster → their id', async () => {
    await expect(getCurrentUserStaffId()).resolves.toBe('u1')
  })
})
