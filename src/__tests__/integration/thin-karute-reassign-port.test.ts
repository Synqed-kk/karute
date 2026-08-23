/**
 * Reassign entries of the thin actions port (F4, packet §2g phone path).
 * Fix round 5 R5-5 / fresh-verify D4: the `satisfies typeof
 * import('@/actions/karute').reassignKaruteCustomer` pin (thin/ports/
 * actions.vite.ts) catches SIGNATURE drift only — never field mapping.
 * Swapping the success mapping to `{ burnCount: body.photo_count,
 * photoCount: body.burn_count }` passed the full suite pre-round-5: the
 * phone confirm panel would tell staff the reverse of the truth on the exact
 * honesty surface F4 exists to provide. Pointing the roster fetch at a
 * nonexistent route also passed (silent empty-roster degrade). Mirrors
 * thin-karute-entry-edit-history-port.test.ts's style/idiom.
 *
 * R11-1 (fix round 11, Greptile round-6 closure — packet pin 5): burn_count
 * split into linked_burn_count + same_day_burn_count on the wire. Every
 * fixture below uses THREE distinct numbers (linked/sameDay/photo) so a
 * swap among any pair — not just linked↔sameDay — flips the assertion.
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { reassignKaruteCustomer, listReassignCustomerOptions } from '../../../thin/ports/actions.vite'

describe('thin actions port — reassign transport contract', () => {
  it('POST /api/app/v1/karute/[id]/reassign with { to_customer_id, confirmed }', async () => {
    const apiFetch = jest.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe('/api/app/v1/karute/kar-1/reassign')
      expect(JSON.parse(init?.body as string)).toEqual({ to_customer_id: 'cust-TO', confirmed: true })
      return new Response(
        JSON.stringify({ ok: true, linked_burn_count: 0, same_day_burn_count: 0, photo_count: 0 }),
        { status: 200 },
      )
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: true })
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('requires_confirm response maps EXACTLY — linkedBurnCount/sameDayBurnCount/photoCount not swapped (D4, R11-1)', async () => {
    const apiFetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            requires_confirm: true,
            from_customer_id: 'cust-FROM',
            from_name: '田中 美咲',
            to_name: '佐藤 花子',
            linked_burn_count: 2,
            same_day_burn_count: 5,
            photo_count: 1,
          }),
          { status: 200 },
        ),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: false })).resolves.toEqual({
      requiresConfirm: true,
      fromCustomerId: 'cust-FROM',
      fromName: '田中 美咲',
      toName: '佐藤 花子',
      linkedBurnCount: 2,
      sameDayBurnCount: 5,
      photoCount: 1,
    })
  })

  it('success response maps EXACTLY — linkedBurnCount/sameDayBurnCount/photoCount not swapped (D4, R11-1, the mutation that survived pre-R11)', async () => {
    const apiFetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, linked_burn_count: 2, same_day_burn_count: 5, photo_count: 1 }),
          { status: 200 },
        ),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: true })).resolves.toEqual({
      success: true,
      linkedBurnCount: 2,
      sameDayBurnCount: 5,
      photoCount: 1,
    })
  })

  it('a non-2xx response (403) maps to { error: message }', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ error: { message: 'forbidden' } }), { status: 403 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: true })).resolves.toEqual({
      error: 'forbidden',
    })
  })

  it('a transport rejection maps to { error: message }, never an escaped rejection', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: true })).resolves.toEqual({
      error: 'Load failed',
    })
  })

  it('GET /api/app/v1/karute/[id]/reassign-options unwraps { customers } (D4: not a nonexistent route)', async () => {
    const customers = [{ id: 'cust-TO', name: '佐藤 花子', furigana: null, phone: null }]
    const apiFetch = jest.fn(async (path: string) => {
      expect(path).toBe('/api/app/v1/karute/kar-1/reassign-options')
      return new Response(JSON.stringify({ customers }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listReassignCustomerOptions('kar-1')).resolves.toEqual({ customers })
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('roster: a non-2xx response degrades to { error: message }, never a throw', async () => {
    const apiFetch = jest.fn(async () => new Response('not json', { status: 500 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listReassignCustomerOptions('kar-1')).resolves.toEqual({
      error: 'Request failed (500)',
    })
  })
})
