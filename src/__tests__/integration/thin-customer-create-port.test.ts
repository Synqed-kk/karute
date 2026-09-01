/**
 * PHONEWIRE-1 — the 新規顧客 create pair's THIN (phone) entry of the actions
 * port. Both were `notWired` stubs, so every phone 新規顧客 save threw before
 * this wiring.
 *
 * The `satisfies typeof import('@/actions/customers').createCustomer` pins in
 * the port bind the RETURN unions only — a function of fewer parameters stays
 * assignable, so a port that silently dropped its argument would still pass
 * tsc. THIS FILE is the real pin on what reaches the wire: the URL, the
 * method, the Idempotency-Key and the body (the #802 arity lesson, same shape
 * as thin-discard-reasons-port.test.ts).
 *
 * A 2xx alone is NOT treated as a create: handler.ts stringifies its ERRORS,
 * so a facade 502 arrives with a perfectly parseable JSON body — the id is the
 * only proof a customer exists (the thin-recording-discard-port lesson).
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { createCustomer, createQuickCustomer } from '../../../thin/ports/actions.vite'

interface Seen {
  path: string
  init?: RequestInit
}

function port(res: (path: string, init?: RequestInit) => Promise<Response>) {
  const seen: Seen[] = []
  const apiFetch = jest.fn(async (path: string, init?: RequestInit) => {
    seen.push({ path, init })
    return res(path, init)
  })
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return seen
}

const okJson = (body: unknown, status = 201) =>
  async () => new Response(JSON.stringify(body), { status })
/** The REAL wire shape of a facade failure: an error body that parses. */
const errorBody = (code: string, message = 'nope') =>
  JSON.stringify({ error: { code, message } })

const FORM_INPUT = {
  name: '山田 花子',
  furigana: 'ヤマダ ハナコ',
  phone: '090-0000-0000',
  email: '',
  assigned_staff_id: '',
  date_of_birth: '',
  gender: '',
  occupation: '',
  member_number: '',
}

describe('thin actions port — createCustomer', () => {
  it('POSTs the collection create route, carrying the WHOLE form body', async () => {
    const seen = port(okJson({ id: 'cust-new' }))

    await createCustomer(FORM_INPUT)

    expect(seen).toHaveLength(1)
    expect(seen[0].path).toBe('/api/app/v1/customers')
    expect(seen[0].init?.method).toBe('POST')
    // The arity pin: every field the staff typed must reach the wire, not just
    // the name.
    expect(JSON.parse(seen[0].init?.body as string)).toEqual(FORM_INPUT)
  })

  it('sends an Idempotency-Key (a retry must not mint a second 顧客)', async () => {
    const seen = port(okJson({ id: 'cust-new' }))
    await createCustomer(FORM_INPUT)
    const key = (seen[0].init?.headers as Record<string, string>)['Idempotency-Key']
    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
  })

  it('2xx with an id → success, and the duplicate warning is forwarded', async () => {
    port(okJson({ id: 'cust-new', duplicateWarning: 'すでに同名の顧客がいます' }))
    await expect(createCustomer(FORM_INPUT)).resolves.toEqual({
      id: 'cust-new',
      success: true,
      duplicateWarning: 'すでに同名の顧客がいます',
    })
  })

  it.each([
    [400, 'validation'],
    [403, 'forbidden'],
    [502, 'upstream_unavailable'],
  ])('%d (%s) → { success: false } carrying the facade message', async (status, code) => {
    port(async () => new Response(errorBody(code), { status }))
    await expect(createCustomer(FORM_INPUT)).resolves.toEqual({ success: false, error: 'nope' })
  })

  it('a 2xx with NO id is not a create', async () => {
    // The class this guard exists for: a parseable body behind a status that
    // proves nothing.
    port(okJson({}, 200))
    await expect(createCustomer(FORM_INPUT)).resolves.toEqual({
      success: false,
      error: 'Create failed (200)',
    })
  })
})

describe('thin actions port — createQuickCustomer (booking + karute pickers)', () => {
  it('POSTs the quick route with a name-only body', async () => {
    const seen = port(okJson({ id: 'cust-new', name: '田中 一郎' }))

    await createQuickCustomer('田中 一郎')

    expect(seen).toHaveLength(1)
    expect(seen[0].path).toBe('/api/app/v1/customers/quick')
    expect(seen[0].init?.method).toBe('POST')
    expect(JSON.parse(seen[0].init?.body as string)).toEqual({ name: '田中 一郎' })
  })

  it('answers the picker with core’s STORED name, not the typed one', async () => {
    port(okJson({ id: 'cust-new', name: '田中 一郎' }))
    await expect(createQuickCustomer('  田中 一郎  ')).resolves.toEqual({
      success: true,
      id: 'cust-new',
      name: '田中 一郎',
    })
  })

  it('a facade rejection surfaces as { success: false } with the message', async () => {
    port(async () => new Response(errorBody('validation', 'name is required'), { status: 400 }))
    await expect(createQuickCustomer('')).resolves.toEqual({
      success: false,
      error: 'name is required',
    })
  })

  it('a 2xx with NO id is not a create', async () => {
    port(okJson({}, 200))
    await expect(createQuickCustomer('田中')).resolves.toEqual({
      success: false,
      error: 'Create failed (200)',
    })
  })
})

// ─────────────────────────────────────────────────────────────
// Offline-catch (PHONEWIRE-3) — the #814 transport-rejection gap
// ─────────────────────────────────────────────────────────────
// These ports SUBSTITUTE for server actions, so a transport rejection
// (offline, DNS, a connection dropped mid-body) must RESOLVE the union's
// failure member, exactly as statusCall / facadeUpsertOrgSettings /
// facadeCustomerDeletion do — never reject. 'Network error' is the constant,
// never the engine's raw text and never an empty string (QuickCreateCustomer
// renders result.error directly, so empty would be a silent failure).
describe('thin actions port — the create pair never REJECTS on a dead network', () => {
  const dead = () => port(async () => Promise.reject(new TypeError('Load failed')))

  it('createCustomer resolves the failure member', async () => {
    dead()
    await expect(createCustomer(FORM_INPUT)).resolves.toEqual({
      success: false,
      error: 'Network error',
    })
  })

  it('createQuickCustomer resolves the failure member', async () => {
    dead()
    await expect(createQuickCustomer('田中 一郎')).resolves.toEqual({
      success: false,
      error: 'Network error',
    })
  })
})
