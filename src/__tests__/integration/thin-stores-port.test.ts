/**
 * Stores/entitlement entries of the thin actions port (design-parity packet
 * 12 §B-3 S2 — 店舗 tab live). Pins the TRANSPORT contract for the 4 newly
 * wired actions (URL, method, headers, unwrap, error mapping):
 *   - listStores: GET, unwraps { stores } → StoreRow[]; a non-ok response
 *     degrades to [] (never throws — StoresSection's refresh() awaits it
 *     with no try/catch of its own).
 *   - createStore: POST with an Idempotency-Key; success → { id }; a
 *     business-level { error } (e.g. STORE_LIMIT_REACHED) rides the 2xx body
 *     VERBATIM; a transport reject maps to { error: message } (same
 *     statusCall/facadeUpsertOrgSettings rationale — handleFormSave awaits
 *     without its own catch).
 *   - updateStore: PATCH, no Idempotency-Key; same success/error contract.
 *   - getEntitlement: GET, unwraps { entitlement }; a non-ok response
 *     degrades to the safe blocked-free default (web parity — getEntitlement
 *     resolves the same shape on an unauthenticated caller).
 *
 * getActiveStoreId (window/localStorage-backed) is pinned separately in
 * thin-active-store-id-port.test.ts — jsdom has no global Response (this
 * file needs real Response objects), same split as
 * thin-org-settings-port.test.ts (node, Response-based) vs.
 * thin-store-heal.test.ts (jsdom, window-based).
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { listStores, createStore, updateStore, getEntitlement } from '../../../thin/ports/actions.vite'

describe('thin actions port — stores/entitlement transport contract', () => {
  it('listStores: GET /api/app/v1/stores, unwraps { stores }', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      expect(path).toBe('/api/app/v1/stores')
      return new Response(JSON.stringify({ stores: [{ id: 's-1', name: '代官山' }] }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const rows = await listStores()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(rows).toEqual([{ id: 's-1', name: '代官山' }])
  })

  it('listStores: a non-ok response degrades to [] (never throws)', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ error: {} }), { status: 403 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listStores()).resolves.toEqual([])
  })

  it('listStores: a transport reject degrades to [] (never throws)', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listStores()).resolves.toEqual([])
  })

  it('createStore: POST with an Idempotency-Key header, success → { id }', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/stores')
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy()
      expect(JSON.parse(init.body as string)).toEqual({ name: '渋谷店' })
      return new Response(JSON.stringify({ id: 'store-new' }), { status: 201 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(createStore({ name: '渋谷店' })).resolves.toEqual({ id: 'store-new' })
  })

  it('createStore: a business-level { error } (STORE_LIMIT_REACHED) rides the 2xx body VERBATIM', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ error: 'STORE_LIMIT_REACHED' }), { status: 200 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(createStore({ name: '渋谷店' })).resolves.toEqual({ error: 'STORE_LIMIT_REACHED' })
  })

  it('createStore: a transport reject maps to { error: message }', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(createStore({ name: '渋谷店' })).resolves.toEqual({ error: 'Load failed' })
  })

  it('updateStore: PATCH to /api/app/v1/stores/[id], no Idempotency-Key, success → { ok: true }', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/stores/store-7')
      expect(init.method).toBe('PATCH')
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeUndefined()
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(updateStore('store-7', { name: 'x' })).resolves.toEqual({ ok: true })
  })

  it('updateStore: a business-level { error } rides the 2xx body VERBATIM', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ error: 'Only the salon owner can manage stores.' }), { status: 200 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(updateStore('store-7', { name: 'x' })).resolves.toEqual({
      error: 'Only the salon owner can manage stores.',
    })
  })

  it('getEntitlement: GET /api/app/v1/entitlement, unwraps { entitlement }', async () => {
    const entitlement = {
      tier: 'professional',
      storeLimit: 'unlimited',
      storeCount: 2,
      isUnlimited: true,
      features: {},
      staffLimit: 'unlimited',
      canAddStore: true,
      enforced: false,
      degraded: false,
    }
    const apiFetch = jest.fn(async (path: string) => {
      expect(path).toBe('/api/app/v1/entitlement')
      return new Response(JSON.stringify({ entitlement }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(getEntitlement()).resolves.toEqual(entitlement)
  })

  it('getEntitlement: a non-ok response degrades to the safe blocked-free default', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ error: {} }), { status: 403 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const result = await getEntitlement()
    expect(result.tier).toBe('free')
    expect(result.canAddStore).toBe(false)
  })
})
