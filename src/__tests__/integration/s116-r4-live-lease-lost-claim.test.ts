/**
 * ⚖ S116 round 4 (#1088, Sonnet NIT) — a caller that loses a claim while a LIVE lease stands behind
 * it answers busy until THAT lease ends, whatever the claim body says. Without this check a claim
 * whose `at` reads old walks on to the next link and takes over a live holder: two payers.
 */
jest.mock('server-only', () => ({}))

/** An in-memory `recordings` bucket: the storage's own create-only refusal, each
 *  object's server-side created_at (the storage clock, `mockClock`), and fault rules
 *  per operation (500 not landed · throw · lands then 500 · garbage read · overwrite). */
type MockObj = { body: string; createdAt: number }
type MockRule = {
  op: 'create' | 'upsert' | 'download' | 'info'
  key: RegExp
  kind: '500' | 'throw' | 'lands500' | 'garbage' | 'overwrite' | 'body'
  times: number
  skip?: number
  body?: string
  err?: boolean
}
const mockObjects = new Map<string, MockObj>()
const mockRules: MockRule[] = []
const mockClock = { now: 0 }
const mockInfo: { fn: null | ((had: MockObj) => unknown) } = { fn: null }
const mockCalls = { info: 0, download: 0 }
function mockRuleFor(op: MockRule['op'], key: string): MockRule | null {
  for (const r of mockRules) {
    if (r.op !== op || r.times === 0 || !r.key.test(key)) continue
    if (r.skip) {
      r.skip--
      continue
    }
    if (r.times > 0) r.times--
    return r
  }
  return null
}
const mockErr = (statusCode: string, message: string) => ({ statusCode, message })
const mockTick = () => new Promise<void>((resolve) => setImmediate(resolve))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        upload: async (key: string, body: string, opts: { upsert: boolean }) => {
          await mockTick()
          const rule = mockRuleFor(opts.upsert ? 'upsert' : 'create', key)
          if (rule?.kind === 'throw') throw new Error('storage threw')
          if (rule?.kind === '500') return { error: mockErr('500', 'Internal') }
          const had = mockObjects.get(key)
          if (!opts.upsert && had) return { error: mockErr('409', 'The resource already exists') }
          const createdAt = had?.createdAt ?? mockClock.now
          mockObjects.set(key, { body, createdAt })
          if (rule?.kind === 'overwrite') {
            mockObjects.set(key, { body: rule.body!, createdAt })
            if (rule.err) return { error: mockErr('500', 'Internal') }
          }
          if (rule?.kind === 'lands500') return { error: mockErr('500', 'Internal') }
          return { error: null }
        },
        download: async (key: string) => {
          await mockTick()
          const rule = mockRuleFor('download', key)
          if (rule?.kind === 'throw') throw new Error('storage threw')
          if (rule?.kind === '500') return { data: null, error: mockErr('500', 'Internal') }
          const had = mockObjects.get(key)
          if (!had) return { data: null, error: mockErr('404', 'Object not found') }
          const text = rule?.kind === 'garbage' ? '{not json' : rule?.kind === 'body' ? rule.body! : had.body
          return { data: { text: async () => text }, error: null }
        },
        info: async (key: string) => {
          await mockTick()
          const rule = mockRuleFor('info', key)
          if (rule?.kind === 'throw') throw new Error('storage threw')
          if (rule?.kind === '500') return { data: null, error: mockErr('500', 'Internal') }
          const had = mockObjects.get(key)
          if (!had) return { data: null, error: mockErr('404', 'Object not found') }
          mockCalls.info++
          if (mockInfo.fn) return mockInfo.fn(had)
          return { data: { name: key, createdAt: new Date(had.createdAt).toISOString() }, error: null }
        },
      }),
    },
  }),
}))

import { takeTranscriptLease, transcriptLeaseClaimKey, transcriptLeaseKey } from '@/lib/recording/transcript-memo'
import { TRANSCRIPT_LEASE_TTL_MS as TTL } from '@/lib/recording/transcript-lease-ttl'

const MEMO = 'trc/biz-1_take-1.ja.json'
const LEASE = transcriptLeaseKey(MEMO)
const T0 = 1_800_000_000_000
const S = 1_000
const DAY = 86_400_000
const nn = (i: number) => i.toString(16).padStart(8, '0') + '-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ck = (nonce: string) => transcriptLeaseClaimKey(MEMO, { until: 0, nonce })
/** One server's take on its own clock `own`; storage's clock reads `store`. */
const takeAt = (own: number, store = own) => {
  mockClock.now = store
  return takeTranscriptLease(MEMO, own)
}
const plant = (key: string, body: unknown, createdAt: number) => mockObjects.set(key, { body: typeof body === 'string' ? body : JSON.stringify(body), createdAt })
const lease = (exp: number, nonce: string) => plant(LEASE, { v: 1, expires_at: exp, nonce }, T0)
let warns: string[] = []
beforeEach(() => {
  mockObjects.clear()
  mockRules.length = 0
  mockInfo.fn = null
  warns = []
  jest.spyOn(console, 'warn').mockImplementation((line: unknown) => {
    try {
      warns.push((JSON.parse(String(line)) as { where: string }).where)
    } catch {
      warns.push(String(line))
    }
  })
})
afterEach(() => jest.restoreAllMocks())

it('the lease read expired at the start, the claim is lost (409), a live lease now stands → busy until it ends, no takeover', async () => {
  const P = T0 + DAY
  lease(P + TTL, nn(5))
  plant(ck(nn(0)), { v: 1, at: P - TTL - S, nonce: nn(5) }, P - TTL - S)
  mockRules.push({ op: 'download', key: /\.lease\.json$/, kind: 'body', body: JSON.stringify({ v: 1, expires_at: T0 + TTL, nonce: nn(0) }), times: 1 })
  expect(await takeAt(P)).toEqual({ state: 'busy', until: P + TTL })
  expect(JSON.parse(mockObjects.get(LEASE)!.body).nonce).toBe(nn(5))
})
