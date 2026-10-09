/**
 * ⚖ S120 (#1088, U1) — pins for the lease take (transcript-memo.ts takeTranscriptLease):
 * (a) `now` read after the create (R-S118-7, GPT-6 finding 1). Payers = takes that answer
 * anything but busy (held or unknown both pay). The bucket is helpers/r5-bucket; `Date.now`
 * is this file's clock, so a stalled storage call can be made to take real time.
 */
jest.mock('server-only', () => ({}))
jest.mock('@/lib/supabase/service', () => jest.requireActual('./helpers/r5-bucket').bucketService)

import { bucket, resetBucket } from './helpers/r5-bucket'
import { takeTranscriptLease, transcriptLeaseKey } from '@/lib/recording/transcript-memo'

const MEMO = 'trc/biz-1_take-1.ja.json'
const LEASE = transcriptLeaseKey(MEMO)
const T0 = 1_800_000_000_000
const S = 1000
const clock = { now: T0 }
type Take = Awaited<ReturnType<typeof takeTranscriptLease>>
const pays = (t: Take) => t.state !== 'busy'
const setClock = (at: number) => { clock.now = at; bucket.clock.now = at }
const take = (at: number) => { setClock(at); return takeTranscriptLease(MEMO, at) }
/** Holds the n-th call of `op` on `key` until opened. */
const gateOn = (op: 'create' | 'upsert' | 'download', key: string, nth = 1) => {
  let open!: () => void
  let hit!: () => void
  const opened = new Promise<void>((r) => { open = r })
  const reached = new Promise<void>((r) => { hit = r })
  bucket.onCall = async (o, k, n) => {
    if (o === op && k === key && n === nth) { hit(); await opened }
    return null
  }
  return { open, reached }
}

beforeEach(() => {
  resetBucket()
  setClock(T0)
  jest.spyOn(Date, 'now').mockImplementation(() => clock.now)
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('(a) a stalled first lease create judges the lease it then reads by the clock after the create', () => {
  it.each([30, 61, 120, 299])('A\'s create stalls %i s, B creates and holds meanwhile: A answers busy, 1 payer', async (stall) => {
    const g = gateOn('create', LEASE, 1)
    const A = take(T0)
    await g.reached
    const B = await take(T0 + stall * S)
    expect(B.state).toBe('held')
    setClock(T0 + (stall + 1) * S)
    g.open()
    const a = await A
    expect(a.state).toBe('busy')
    expect([a, B].filter(pays)).toHaveLength(1)
  })
})
