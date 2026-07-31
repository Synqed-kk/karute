/**
 * Staff profile/authority entries of the thin actions port (design-parity
 * packet 12 §B-3 S4b tab-live prerequisite). Pins the TRANSPORT contract
 * (URL, method, headers, unwrap, error mapping) for the 8 ports that were
 * still notWired() when the スタッフ tab went live, same class as
 * thin-stores-port.test.ts:
 *   - createStaff: POST with an Idempotency-Key; success → void; a
 *     business-level { error } rides the 2xx body VERBATIM; a transport
 *     reject maps to { error: message }.
 *   - updateStaff: PATCH, no Idempotency-Key; success → void; same error
 *     contract.
 *   - deleteStaff: DELETE; success → void; same error contract.
 *   - uploadStaffAvatar: POST multipart (FormData body, no explicit
 *     Content-Type — the browser sets the boundary); success → { url };
 *     same error contract.
 *   - getStaffPermissions: GET; the 2xx body IS the union already
 *     ({ permissionRole, capabilities, isOwner } | { error }) — verbatim
 *     passthrough.
 *   - setStaffPermissions: PUT; same verbatim-passthrough class.
 *   - getStaffStores: GET; unwraps { storeIds } → string[]; ANY failure
 *     (403/500/transport reject) degrades to [] — web-exact (the action
 *     never throws).
 *   - setStaffStores: PUT; { ok: true } | { error } rides the 2xx body
 *     VERBATIM; a facade 403 { error: { code: 'forbidden' } } maps to web's
 *     own STORE_OWNER_DENIAL copy (same "forbidden code → the action's own
 *     copy" idiom as upsertOrgSettings's forbidden mapping).
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import {
  createStaff,
  updateStaff,
  deleteStaff,
  uploadStaffAvatar,
  getStaffPermissions,
  setStaffPermissions,
  getStaffStores,
  setStaffStores,
} from '../../../thin/ports/actions.vite'

const STAFF_DATA = { name: 'Ada', position: '', email: 'ada@example.com', phone: '' }

describe('thin actions port — staff create/update/delete', () => {
  it('createStaff: POST /api/app/v1/staff with an Idempotency-Key header, success → void', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/staff')
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy()
      expect(JSON.parse(init.body as string)).toEqual(STAFF_DATA)
      return new Response(JSON.stringify({ id: 'staff-new' }), { status: 201 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(createStaff(STAFF_DATA)).resolves.toBeUndefined()
  })

  it('createStaff: a business-level { error } (plan limit) rides the 2xx body VERBATIM', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ error: 'Staff limit reached for the current plan.' }), { status: 200 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(createStaff(STAFF_DATA)).resolves.toEqual({
      error: 'Staff limit reached for the current plan.',
    })
  })

  it('createStaff: a transport reject maps to { error: message }', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(createStaff(STAFF_DATA)).resolves.toEqual({ error: 'Load failed' })
  })

  it('updateStaff: PATCH to /api/app/v1/staff/[id], no Idempotency-Key, success → void', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/staff/staff-9')
      expect(init.method).toBe('PATCH')
      expect((init.headers as Record<string, string> | undefined)?.['Idempotency-Key']).toBeUndefined()
      expect(JSON.parse(init.body as string)).toEqual(STAFF_DATA)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(updateStaff('staff-9', STAFF_DATA)).resolves.toBeUndefined()
  })

  it('updateStaff: a business-level { error } rides the 2xx body VERBATIM', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ error: 'noPermission' }), { status: 200 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(updateStaff('staff-9', STAFF_DATA)).resolves.toEqual({ error: 'noPermission' })
  })

  it('deleteStaff: DELETE to /api/app/v1/staff/[id], success → void', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/staff/staff-9')
      expect(init.method).toBe('DELETE')
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(deleteStaff('staff-9')).resolves.toBeUndefined()
  })

  it('deleteStaff: a business-level { error } (last-member guard) rides the 2xx body VERBATIM', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ error: 'Cannot delete the last staff member.' }), { status: 200 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(deleteStaff('staff-9')).resolves.toEqual({
      error: 'Cannot delete the last staff member.',
    })
  })

  it('deleteStaff: a transport reject maps to { error: message }', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(deleteStaff('staff-9')).resolves.toEqual({ error: 'Load failed' })
  })
})

describe('thin actions port — staff avatar upload', () => {
  it('uploadStaffAvatar: POST multipart to /api/app/v1/staff/[id]/avatar, success → { url }', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/staff/staff-9/avatar')
      expect(init.method).toBe('POST')
      expect(init.body).toBeInstanceOf(FormData)
      // The browser sets the multipart Content-Type + boundary — the port
      // must never set it by hand (would drop the boundary the server needs).
      expect((init.headers as Record<string, string> | undefined)?.['Content-Type']).toBeUndefined()
      return new Response(JSON.stringify({ url: 'https://cdn.test/a.png' }), { status: 201 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const fd = new FormData()
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }))
    await expect(uploadStaffAvatar('staff-9', fd)).resolves.toEqual({ url: 'https://cdn.test/a.png' })
  })

  it('uploadStaffAvatar: a validation failure (magic-byte sniff) maps to { error: message }', async () => {
    const apiFetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: 'file content is not a recognized image format' } }),
          { status: 400 },
        ),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const fd = new FormData()
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'fake.png', { type: 'image/png' }))
    await expect(uploadStaffAvatar('staff-9', fd)).resolves.toEqual({
      error: 'file content is not a recognized image format',
    })
  })
})

describe('thin actions port — staff permissions', () => {
  it('getStaffPermissions: GET to /api/app/v1/staff/[id]/permissions, verbatim passthrough', async () => {
    const perms = { permissionRole: 'manager', capabilities: ['staff.manage'], isOwner: false }
    const apiFetch = jest.fn(async (path: string) => {
      expect(path).toBe('/api/app/v1/staff/staff-9/permissions')
      return new Response(JSON.stringify(perms), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(getStaffPermissions('staff-9')).resolves.toEqual(perms)
  })

  it('getStaffPermissions: a business-level { error } (e.g. staff not found) rides the 2xx body VERBATIM', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ error: 'Staff not found' }), { status: 200 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(getStaffPermissions('staff-9')).resolves.toEqual({ error: 'Staff not found' })
  })

  it('getStaffPermissions: missing staff.manage (403) maps to { error: message }', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ error: { message: 'Missing capability: staff.manage' } }), { status: 403 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(getStaffPermissions('staff-9')).resolves.toEqual({ error: 'Missing capability: staff.manage' })
  })

  it('setStaffPermissions: PUT to /api/app/v1/staff/[id]/permissions, body { permissionRole, capabilities }, verbatim passthrough', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/staff/staff-9/permissions')
      expect(init.method).toBe('PUT')
      expect(JSON.parse(init.body as string)).toEqual({
        permissionRole: 'manager',
        capabilities: ['staff.manage'],
      })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(setStaffPermissions('staff-9', 'manager', ['staff.manage'])).resolves.toEqual({ ok: true })
  })

  it('setStaffPermissions: a business-level { error } (no-escalation-by-delta) rides the 2xx body VERBATIM', async () => {
    const apiFetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: 'You can only grant permissions you have yourself.' }), { status: 200 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(setStaffPermissions('staff-9', 'custom', ['billing.manage'])).resolves.toEqual({
      error: 'You can only grant permissions you have yourself.',
    })
  })
})

describe('thin actions port — staff-stores assignment', () => {
  it('getStaffStores: GET to /api/app/v1/staff/[id]/stores, unwraps { storeIds }', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      expect(path).toBe('/api/app/v1/staff/staff-9/stores')
      return new Response(JSON.stringify({ storeIds: ['store-a', 'store-b'] }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(getStaffStores('staff-9')).resolves.toEqual(['store-a', 'store-b'])
  })

  it('getStaffStores: a 403 (missing staff.manage floor) degrades to [] — web-exact, never throws', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ error: {} }), { status: 403 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(getStaffStores('staff-9')).resolves.toEqual([])
  })

  it('getStaffStores: a transport reject degrades to [] — web-exact, never throws', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(getStaffStores('staff-9')).resolves.toEqual([])
  })

  it('setStaffStores: PUT to /api/app/v1/staff/[id]/stores, body { storeIds }, verbatim passthrough', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/staff/staff-9/stores')
      expect(init.method).toBe('PUT')
      expect(JSON.parse(init.body as string)).toEqual({ storeIds: ['store-a'] })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(setStaffStores('staff-9', ['store-a'])).resolves.toEqual({ ok: true })
  })

  it('setStaffStores: a facade 403 forbidden envelope (non-owner) maps to web\'s own STORE_OWNER_DENIAL copy', async () => {
    const apiFetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Missing capability: x' } }), {
          status: 403,
        }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(setStaffStores('staff-9', ['store-a'])).resolves.toEqual({
      error: 'Only the salon owner can manage stores.',
    })
  })

  it('setStaffStores: a transport reject maps to { error: message }', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(setStaffStores('staff-9', ['store-a'])).resolves.toEqual({ error: 'Load failed' })
  })
})
