/**
 * R-S126-10 (c), cold read F2: the settle pass serializes rows PER CUSTOMER.
 * Two pending walk-in replays of one customer: the earlier row's claim lands
 * before the next row's R4 pre-read, so each is sent under its own key and
 * settles to its own core row. Across customers the pass still runs in parallel.
 * The fake core writes its row at once and answers later; its pre-read list is
 * read when it answers (a network read) — the window F2 needs.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://placeholder.invalid'
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))

import { settlePending, type IntentRow } from '@/lib/packs/use-ledger'
import { memLedgerStore } from './helpers/ledger-fake'

const B = '00000000-0000-4000-8000-0000000000c3'
const NOW = new Date('2026-10-20T03:00:00.000Z') // 12:00 JST, after the cutover day
const DAY = '2026-10-20'
const CUSTOMERS = ['cust-a', 'cust-b', 'cust-c']
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function walkIn(id: string, customer: string, createdAt: string): IntentRow {
  const payload = { customer_id: customer, pack_id: `pack-${customer}`, redeemed_on: DAY, appointment_id: null, karute_record_id: null, source: 'manual', created_by: null, counts_as_visit: true }
  return {
    id, business_id: B, owner_user_id: null, kind: 'use', ledger_source: 'record', core_source: 'manual',
    customer_id: customer, pack_id: payload.pack_id, pack_picked_by: 'staff', appointment_id: null, appointment_resolved: true,
    gesture_at: '2026-10-20T01:00:00.000Z', gesture_at_client: null, clock_suspect: false, redeemed_on: DAY,
    counts_as_visit: true, another_session: true, frozen_payload: payload, audit_payload: {},
    state: 'pending', attempts: 1, held_at: null, held_against: null, created_at: createdAt, leased_until: null,
  } as unknown as IntentRow
}

function fakeCore() {
  const rows: Array<{ id: string; customer_id: string; appointment_id: null; redeemed_on: string; source: string }> = []
  const inFlight = new Map<string, number>()
  const maxPer = new Map<string, number>()
  const sentKeys: string[] = []
  let live = 0
  let maxAll = 0
  const addRedemption = jest.fn(async (...args: unknown[]) => {
    const s = JSON.stringify(args)
    const customer = CUSTOMERS.find((c) => s.includes(`"${c}"`)) ?? '?'
    sentKeys.push(s)
    live += 1; maxAll = Math.max(maxAll, live)
    inFlight.set(customer, (inFlight.get(customer) ?? 0) + 1)
    maxPer.set(customer, Math.max(maxPer.get(customer) ?? 0, inFlight.get(customer) ?? 0))
    const id = `core-${rows.length + 1}`
    rows.push({ id, customer_id: customer, appointment_id: null, redeemed_on: DAY, source: 'manual' }) // the core row exists at once…
    await sleep(20) // …the answer comes later
    live -= 1; inFlight.set(customer, (inFlight.get(customer) ?? 1) - 1)
    return { id }
  })
  const listRecentRedemptions = jest.fn(async () => { await sleep(10); return rows.map((r) => ({ ...r })) })
  return { addRedemption, sentKeys, maxPer, maxAll: () => maxAll, synqed: { packs: { addRedemption, listRecentRedemptions }, appointments: {} } as never }
}

const pass = (store: ReturnType<typeof memLedgerStore>, synqed: never) =>
  settlePending({ store, clientFor: () => synqed, rotate: (ids) => [...ids], dailyPass: false, now: () => NOW })
const read = async (store: ReturnType<typeof memLedgerStore>, ids: string[]) => (await Promise.all(ids.map((id) => store.getAllById(id)))).flat()

test('two pending walk-in intents, same customer, one pass → two core calls, two settled rows, two distinct core ids', async () => {
  const store = memLedgerStore()
  const c = fakeCore()
  await store.insertIgnore(walkIn('a-1', 'cust-a', '2026-10-20T01:00:00.000Z'))
  await store.insertIgnore(walkIn('a-2', 'cust-a', '2026-10-20T01:05:00.000Z'))
  await pass(store, c.synqed)
  expect(c.addRedemption).toHaveBeenCalledTimes(2)
  const rows = await read(store, ['a-1', 'a-2'])
  expect(rows.map((r) => r.state)).toEqual(['settled', 'settled'])
  expect(new Set(rows.map((r) => r.settled_core_id)).size).toBe(2)
  expect(c.maxPer.get('cust-a')).toBe(1)
})

test('a mixed batch: customers run in parallel; one customer\'s rows run one at a time, in created_at order', async () => {
  const store = memLedgerStore()
  const c = fakeCore()
  await store.insertIgnore(walkIn('a-late', 'cust-a', '2026-10-20T01:09:00.000Z'))
  await store.insertIgnore(walkIn('b-1', 'cust-b', '2026-10-20T01:01:00.000Z'))
  await store.insertIgnore(walkIn('a-early', 'cust-a', '2026-10-20T01:02:00.000Z'))
  await store.insertIgnore(walkIn('c-1', 'cust-c', '2026-10-20T01:03:00.000Z'))
  await pass(store, c.synqed)
  expect(c.addRedemption).toHaveBeenCalledTimes(4)
  const rows = await read(store, ['a-late', 'b-1', 'a-early', 'c-1'])
  expect(rows.every((r) => r.state === 'settled')).toBe(true)
  expect(new Set(rows.map((r) => r.settled_core_id)).size).toBe(4)
  expect(c.maxAll()).toBeGreaterThanOrEqual(3) // three customers in flight together
  expect([...c.maxPer.values()]).toEqual([1, 1, 1])
  const order = (id: string) => c.sentKeys.findIndex((s) => s.includes(`"${id}"`))
  expect(order('a-early')).toBeGreaterThanOrEqual(0)
  expect(order('a-early')).toBeLessThan(order('a-late'))
})
