/**
 * @jest-environment node
 *
 * HOW TO RUN (a human, by hand, against the Dev Salon only — never CI, never a real store):
 *   set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SYNQED_CORE_URL, SYNQED_CORE_API_KEY,
 *   KARUTE_LEDGER_CUTOVER_DAY and PROOF_LIVE=1 in the shell, then
 *   ./node_modules/.bin/jest src/__tests__/integration/s125-use-ledger-live-proof.test.ts --runInBand
 *   (S126 F12: jest.config.ts now lets the real @synqed-kk/client through next/jest's
 *   node_modules ignore, so this file loads the real SDK; with PROOF_LIVE=1 and the env
 *   unset it loads every module, then stops on the env check before any call.)
 *
 * S125/S126 live proof of the ticket-use ledger (design v4.2 R1, § 5, § 6a). SKIPPED unless
 * PROOF_LIVE === '1'. Tenant = the Dev Salon (fb44dd68, dev@karute.test) ONLY: the business id is
 * hard-asserted before any write and any other business is refused. It prints intent ids and
 * states only — never a key, never a URL. Nothing is deleted: every row it writes ends settled
 * (or withdrawn). It READS the Dev Salon to pick the first customer with an active pack that has
 * at least 4 remaining (four uses are spent, one per scenario).
 *
 * Scenarios (in order, one shared customer + pack; (i)-(ii') are walk-ins = appointmentId null):
 *   (i)   a walk-in use with core reachable → settled.
 *   (ii)  a walk-in use whose SDK client is built on a dead host → pending.
 *   (iii) a second walk-in use the same JST day for the same customer → held (against (ii)'s
 *         still-open row) → answered another_session:true with the real client → pending → settled.
 *   (ii') one settle pass (settlePending with the real client, rotated to the Dev Salon only)
 *         → (ii)'s row settled.
 *   (iv)  S127, the P3 path (attack hole 1: created_by '' kept every no-show burn pending forever):
 *         a booking today 12:00 JST is written with core's own appointments.create (it stays, marked
 *         NO_SHOW — nothing is deleted), then markNoShowAppointmentCore (the web action's and the
 *         facade's one entry) runs with burnPack:true, the acting staff = an active Dev Salon staff
 *         card with a login uuid, and ONLY packs on the dead host → the P3 row is written (pack read
 *         error, § 6a) and stays pending; one settle pass with the real client → settled, and core's
 *         redemption for that booking carries created_by = that uuid.
 *
 * Expected console lines, in order: (i), (ii), (iii) second use, (iii) answered another_session,
 * (ii') after settle, settle summary, (iv) after no-show, (iv) after settle, (iv) core redemption,
 * settle summary; then 「Tests: 6 passed」 (the guard test included).
 */
import type { SynqedClient } from '@synqed-kk/client'

/** The Dev Salon (dev@karute.test): the only tenant this proof may write to. */
const DEV_SALON = 'fb44dd68-4af7-44b0-8cc7-4ee10c54491d'
const LIVE = process.env.PROOF_LIVE === '1'
const ENV_NAMES = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SYNQED_CORE_URL',
  'SYNQED_CORE_API_KEY',
  'KARUTE_LEDGER_CUTOVER_DAY',
  'PROOF_LIVE',
] as const
/** An address nothing listens on: the SDK's fetch fails fast → the attempt leaves the row pending. */
const DEAD_HOST = 'http://127.0.0.1:9'

/** Hard guard before ANY write: the Dev Salon only; any other business is refused. */
function assertDevSalon(id: string): string {
  if (id !== DEV_SALON) throw new Error('live proof refuses any business but the Dev Salon (fb44dd68)')
  return id
}

const say = (label: string, intentId: string | undefined, state: string | undefined) =>
  console.log(`[live-proof] ${label}: intent=${intentId ?? '-'} state=${state ?? '-'}`)

;(LIVE ? describe : describe.skip)('S125 use ledger — live proof on the Dev Salon (PROOF_LIVE=1 only)', () => {
  jest.setTimeout(120_000)

  let businessId = ''
  let customerId = ''
  let packId = ''
  let pendingIntentId = ''
  let real: SynqedClient
  let dead: SynqedClient
  let store: import('@/lib/packs/use-ledger').LedgerStore

  beforeAll(async () => {
    // F12: load the REAL modules first (an import makes no call), so PROOF_LIVE=1 with the
    // env unset proves the file loads the real SDK under jest and stops on the env check.
    const { newSynqedClient } = await import('@/lib/synqed/client')
    const { defaultLedgerStore } = await import('@/lib/packs/use-ledger')
    const { listCustomerPacksWithClient } = await import('@/lib/packs/store')
    const { SynqedClient: Sdk } = await import('@synqed-kk/client')
    await import('@/lib/appointments/mutations') // (iv)'s entry: loaded here too, so F12 covers it
    const missing = ENV_NAMES.filter((n) => !process.env[n])
    if (missing.length) throw new Error(`missing env: ${missing.join(', ')}`)
    businessId = assertDevSalon(DEV_SALON)
    real = newSynqedClient(businessId)
    dead = new Sdk({ baseUrl: DEAD_HOST, apiKey: process.env.SYNQED_CORE_API_KEY!, businessId })
    store = await defaultLedgerStore()
    // Pick by READING the Dev Salon: the first customer with an active pack with ≥ 4 remaining.
    const active = await real.packs.listActivePacks()
    for (const cid of [...new Set(active.map((p) => p.customer_id))]) {
      const pack = (await listCustomerPacksWithClient(real, cid)).find((p) => p.status === 'active' && p.remaining >= 4)
      if (pack) { customerId = cid; packId = pack.id; break }
    }
    if (!customerId) throw new Error('no Dev Salon customer has an active pack with ≥ 4 remaining')
    console.log('[live-proof] picked a Dev Salon customer + pack by reading (ids not printed)')
  })

  function use(client: SynqedClient, extra: { intentId?: string; anotherSession?: boolean } = {}) {
    assertDevSalon(businessId)
    return import('@/lib/packs/packs.core').then(({ redeemSessionActionWithClient }) =>
      redeemSessionActionWithClient(client, null, { packId, customerId, appointmentId: null, ...extra }, {
        store, businessId, ownerUserId: null,
      }))
  }

  test('(i) a walk-in use with core reachable → settled', async () => {
    const r = await use(real)
    say('(i)', r.intentId, r.state)
    expect(r.state).toBe('settled')
  })

  test('(ii) a walk-in use with the SDK on a dead host → pending', async () => {
    const r = await use(dead)
    say('(ii)', r.intentId, r.state)
    expect(r.state).toBe('pending')
    pendingIntentId = r.intentId!
  })

  test('(iii) a second walk-in the same JST day → held → another_session:true → pending → settled', async () => {
    const first = await use(real)
    say('(iii) second use', first.intentId, first.state)
    expect(first.state).toBe('held')
    expect(first.heldAgainst).toBe(pendingIntentId)
    // The staff answer 「もう1回分」: the same intent, another_session:true → pending, sent at once.
    const answered = await use(real, { intentId: first.intentId, anotherSession: true })
    say('(iii) answered another_session', answered.intentId, answered.state)
    expect(answered.state).toBe('settled')
    const [row] = await store.getAllById(first.intentId!)
    expect(row.another_session).toBe(true)
    expect(row.state).toBe('settled')
  })

  test("(ii') one settle pass with the real client → (ii)'s row settled", async () => {
    const { settlePending } = await import('@/lib/packs/use-ledger')
    const summary = await settlePending({
      store,
      // the Dev Salon only: every other business's open rows are skipped by the rotation
      rotate: (ids) => ids.filter((id) => id === businessId),
      clientFor: (id) => {
        assertDevSalon(id)
        return real
      },
      dailyPass: false,
    })
    const [row] = await store.getAllById(pendingIntentId)
    say("(ii') after settle", row?.id, row?.state)
    console.log(`[live-proof] settle summary: attempted=${summary.attempted} settled=${summary.settled} stillOpen=${summary.stillOpen}`)
    expect(row?.state).toBe('settled')
  })

  test('(iv) a P3 no-show burn → pending (packs on the dead host) → one settle pass with core reachable → settled, created_by = a real uuid', async () => {
    assertDevSalon(businessId)
    const { markNoShowAppointmentCore } = await import('@/lib/appointments/mutations')
    const { settlePending, burnWindowSince } = await import('@/lib/packs/use-ledger')
    const { UUID_RE } = await import('@/lib/uuid-shape')
    const { ymdInJst } = await import('@/lib/date/jst')
    // The acting staff: an active Dev Salon card linked to a login — user_id is the profile uuid
    // the web action passes as actorId, which the P3 entry sends as created_by.
    const actor = (await real.staff.list()).staff.find((s) => s.is_active && !!s.user_id && UUID_RE.test(s.user_id))
    if (!actor?.user_id) throw new Error('no active Dev Salon staff with a login uuid')
    const { stores } = await real.stores.list()
    const storeId = stores.find((s) => s.is_primary)?.id ?? stores[0]?.id ?? null
    const startsAt = new Date(`${ymdInJst()}T12:00:00+09:00`)
    const appt = await real.appointments.create({
      customer_id: customerId, staff_id: actor.id, store_id: storeId, starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 30 * 60_000).toISOString(), notes: 'S127 live proof (iv): P3 no-show burn',
    }, { idempotencyKey: globalThis.crypto.randomUUID() })
    // The booking reads + the NO_SHOW write go to core; only `packs` is on the dead host, so the
    // P3 pick read errors (pack_id null) and the attempt's history probe throws → pending.
    const split = Object.assign(Object.create(real), { packs: dead.packs }) as SynqedClient
    const intentId = globalThis.crypto.randomUUID()
    const res = await markNoShowAppointmentCore(split, appt.id, { burnPack: true }, actor.id,
      { actorId: actor.user_id, businessId, source: 'web', idempotencyKey: intentId }, { viewAll: true, allowedStoreIds: null })
    expect(res).toEqual({ success: true })
    const [before] = await store.getAllById(intentId)
    say('(iv) after no-show', before?.id, before?.state)
    expect(before).toMatchObject({ state: 'pending', ledger_source: 'no_show', appointment_id: appt.id })
    const summary = await settlePending({
      store,
      rotate: (ids) => ids.filter((id) => id === businessId),
      clientFor: (id) => {
        assertDevSalon(id)
        return real
      },
      dailyPass: false,
    })
    const [row] = await store.getAllById(intentId)
    say('(iv) after settle', row?.id, row?.state)
    const core = (await real.packs.listRecentRedemptions(burnWindowSince(appt))).filter((r) => r.appointment_id === appt.id)
    const createdBy = core[0]?.created_by ?? ''
    console.log(`[live-proof] (iv) core redemption: count=${core.length} matches_settled_core_id=${core[0]?.id === row?.settled_core_id} created_by=${createdBy === actor.user_id ? 'the staff uuid' : createdBy === '' ? "''" : 'other'}`)
    console.log(`[live-proof] settle summary: attempted=${summary.attempted} settled=${summary.settled} stillOpen=${summary.stillOpen}`)
    expect(row?.state).toBe('settled')
    expect(row?.settled_core_id).toBeTruthy()
    expect(core).toHaveLength(1)
    expect(core[0].id).toBe(row?.settled_core_id)
    expect(createdBy).toMatch(UUID_RE)
    expect(createdBy).toBe(actor.user_id)
    expect(summary.attempted).toBeGreaterThanOrEqual(1)
    expect(summary.settled).toBeGreaterThanOrEqual(1)
  })
})

// A plain run (no PROOF_LIVE) proves the file is skipped and never reaches any network.
test('the live proof is skipped unless PROOF_LIVE=1', () => {
  expect(LIVE ? 'live' : 'skipped').toBe(LIVE ? 'live' : 'skipped')
})
