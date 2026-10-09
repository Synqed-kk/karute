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

// ⚖ S120 (G5, thread 4131459880; S58 F6/W7): a present but unusable lease is taken over through
// the claim, like an expired one. Bodies: R4's four plus a 0-byte body, an infinite expiry
// (S58 W7's 1e999) and an impossible (far-ahead) one.
const FAR_NONCE = '00000000-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BAD: Record<string, (t: number) => string> = {
  notJson: () => '{not json',
  v2: () => JSON.stringify({ v: 2, expires_at: 1, nonce: 'aaaaaaaa' }),
  strExpiry: () => JSON.stringify({ v: 1, expires_at: 'soon', nonce: 'aaaaaaaa' }),
  nullBody: () => 'null',
  zeroBytes: () => '',
  infinite: () => '{"v":1,"expires_at":1e999}',
  farAhead: (t) => JSON.stringify({ v: 1, expires_at: t + 1_000 * S, nonce: FAR_NONCE }),
}
const plant = (k: string, body: string) => bucket.objects.set(k, { body, createdAt: clock.now })
const leaseNonce = () => { try { return (JSON.parse(bucket.objects.get(LEASE)!.body) as { nonce?: string }).nonce } catch { return undefined } }
/** 0-3 ms of jitter before every storage call: random interleavings, seeded. */
const jitter = (seed: number) => {
  let x = seed
  const rand = () => { let t = (x += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  bucket.onCall = () => new Promise((r) => setTimeout(() => r(null), Math.floor(rand() * 4)))
}

describe('(b) G5 a present but unusable lease is taken over through the claim', () => {
  it.each(Object.keys(BAD))('lease %s at +0 s, +1 h, +1 day, +30 days: one taker holds and rewrites it, the next caller is busy', async (name) => {
    for (const off of [0, 3_600 * S, 86_400 * S, 30 * 86_400 * S]) {
      resetBucket()
      const t = T0 + off
      setClock(t)
      plant(LEASE, BAD[name](t))
      const first = await take(t)
      expect(first.state).toBe('held')
      expect(leaseNonce()).toBe(first.state === 'held' ? first.lease.nonce : 'none')
      expect((await take(t + S)).state).toBe('busy')
    }
  })

  it('a FAILED lease read is not an unusable lease: it still answers unknown and writes nothing', async () => {
    plant(LEASE, '{not json')
    bucket.onCall = (op, key) => (op === 'download' && key === LEASE ? '500' : null)
    expect((await take(T0)).state).toBe('unknown')
    expect(bucket.objects.get(LEASE)!.body).toBe('{not json')
  })

  it('two overlapping callers on one unusable lease: exactly one payer', async () => {
    plant(LEASE, '{not json')
    const r = await Promise.all([take(T0), take(T0)])
    expect(r.filter(pays)).toHaveLength(1)
  })

  it('the next takeover after the unusable one chains normally (its claim is keyed by the taker\'s nonce)', async () => {
    plant(LEASE, 'null')
    const u = await take(T0)
    if (u.state !== 'held') throw new Error('not held')
    const next = await take(T0 + 331 * S)
    expect(next.state).toBe('held')
    expect(bucket.objects.has(LEASE.replace(/\.lease\.json$/, `.lease.${u.lease.nonce}.claim.json`))).toBe(true)
  })

  it('burst: 200 seeds x bursts of 2/3/10 on one unusable lease, random interleavings: at most 1 payer, never 0', async () => {
    const seeds = Number(process.env.U1_SEEDS ?? 200)
    const rows: string[] = []
    for (const n of [2, 3, 10]) {
      let worst = 0
      let none = 0
      for (let seed = 1; seed <= seeds; seed++) {
        resetBucket()
        plant(LEASE, BAD[['notJson', 'v2', 'infinite', 'farAhead'][seed % 4]](T0))
        jitter(seed * 7919 + n)
        const p = (await Promise.all(Array.from({ length: n }, () => take(T0)))).filter(pays).length
        worst = Math.max(worst, p)
        if (p === 0) none++
      }
      rows.push(`G5 burst n=${n} seeds=${seeds}: worst payers=${worst} trials with 0 payers=${none}`)
      expect(worst).toBe(1)
      expect(none).toBe(0)
    }
    process.stderr.write(rows.join('\n') + '\n')
  }, 600_000)
})
