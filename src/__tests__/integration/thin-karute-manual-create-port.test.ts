/**
 * PHONEWIRE-2A — the ＋新規カルテ manual-create THIN (phone) entry of the
 * actions port. It was a deliberate SOFT stub (an { error } explaining it was
 * unwired), so every phone ＋新規カルテ save showed the dialog's inline error.
 *
 * The `satisfies typeof import('@/actions/karute').createManualKaruteRecord`
 * pin in the port binds the RETURN union only — a function of fewer parameters
 * stays assignable, so a port that silently dropped its argument would still
 * pass tsc. THIS FILE is the real pin on what reaches the wire (the #802 arity
 * lesson), plus the two halves of the action's contract the dialog depends on:
 *
 *   SUCCESS → navigates, then throws NEXT_REDIRECT; NEVER returns a value.
 *   FAILURE → RETURNS { error }; NEVER throws (NewKaruteDialog renders only
 *             RETURNED errors — a throw bypasses its inline role="alert" and
 *             leaves the dialog hanging, Greptile P1 on #484).
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

const navigated: string[] = []
jest.mock('../../../thin/ports/nav.vite', () => ({
  ...jest.requireActual('../../../thin/ports/nav.vite'),
  redirect: (href: string) => {
    navigated.push(href)
  },
}))

import { createManualKaruteRecord } from '../../../thin/ports/actions.vite'

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

const okJson = (body: unknown, status = 201) => async () => new Response(JSON.stringify(body), { status })
/** The REAL wire shape of a facade failure: an error body that parses. */
const errorBody = (code: string, message = 'nope') => JSON.stringify({ error: { code, message } })

const INPUT = {
  customerId: 'cust-1',
  staffId: 'staff-1',
  sessionDate: '2026-08-30',
  durationMinutes: 60,
  service: 'カット',
}

beforeEach(() => {
  navigated.length = 0
})

describe('thin actions port — createManualKaruteRecord', () => {
  it('POSTs the manual-create route, carrying the WHOLE dialog body', async () => {
    const seen = port(okJson({ id: 'kar-new' }))

    await expect(createManualKaruteRecord(INPUT)).rejects.toThrow('NEXT_REDIRECT')

    expect(seen).toHaveLength(1)
    expect(seen[0].path).toBe('/api/app/v1/karute/manual')
    expect(seen[0].init?.method).toBe('POST')
    // The arity pin: every field the staff picked must reach the wire.
    expect(JSON.parse(seen[0].init?.body as string)).toEqual(INPUT)
  })

  it('never sends a store — the route takes it from the Bearer clamp (⚖ store isolation)', async () => {
    const seen = port(okJson({ id: 'kar-new' }))
    await expect(createManualKaruteRecord(INPUT)).rejects.toThrow('NEXT_REDIRECT')
    const body = JSON.parse(seen[0].init?.body as string)
    expect(body).not.toHaveProperty('storeId')
    expect(body).not.toHaveProperty('store_id')
  })

  it('sends an Idempotency-Key (a retry must not mint a second カルテ)', async () => {
    const seen = port(okJson({ id: 'kar-new' }))
    await expect(createManualKaruteRecord(INPUT)).rejects.toThrow('NEXT_REDIRECT')
    const key = (seen[0].init?.headers as Record<string, string>)['Idempotency-Key']
    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
  })

  // ── the SUCCESS contract: navigate, then throw; never return ──────────────
  it('SUCCESS navigates to the new カルテ and throws NEXT_REDIRECT (never returns)', async () => {
    port(okJson({ id: 'kar-new' }))
    await expect(createManualKaruteRecord(INPUT)).rejects.toThrow('NEXT_REDIRECT')
    // Navigation happens BEFORE the marker throw, exactly like facadeSaveKarute.
    expect(navigated).toEqual(['/karute/kar-new'])
  })

  // ── the FAILURE contract: return { error }; never throw ───────────────────
  it.each([
    [400, 'validation'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [502, 'upstream_unavailable'],
  ])('%d (%s) → RETURNS { error } carrying the facade message, and does not navigate', async (status, code) => {
    port(async () => new Response(errorBody(code), { status }))
    await expect(createManualKaruteRecord(INPUT)).resolves.toEqual({ error: 'nope' })
    expect(navigated).toEqual([])
  })

  it('a 2xx with NO id is not a create (handler.ts stringifies its errors too)', async () => {
    port(okJson({}, 200))
    await expect(createManualKaruteRecord(INPUT)).resolves.toEqual({ error: 'Create failed (200)' })
    expect(navigated).toEqual([])
  })

  it('a TRANSPORT rejection (dropped wifi) RETURNS { error } — never an unhandled throw', async () => {
    // The dialog awaits this inside startTransition with NO try/catch, so a
    // rejection escaping here is an unhandled rejection with no error UI.
    port(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(createManualKaruteRecord(INPUT)).resolves.toEqual({ error: 'Failed to fetch' })
    expect(navigated).toEqual([])
  })

  it('an UNPARSEABLE body behind a non-2xx still returns the status-shaped { error }', async () => {
    port(async () => new Response('<html>gateway</html>', { status: 502 }))
    await expect(createManualKaruteRecord(INPUT)).resolves.toEqual({ error: 'Create failed (502)' })
  })
})
