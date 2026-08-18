/**
 * Staff credential/identity entries of the thin actions port (design-parity
 * packet 12 §B-3 S4b). Pins the TRANSPORT contract (URL, method, headers,
 * unwrap, error mapping) for the 7 ports wired alongside the PIN/voice/invite
 * facade routes, same class as thin-staff-profile-port.test.ts:
 *   - setStaffPin: PUT, body { pin }; the core's own { error? } result rides
 *     the 2xx body VERBATIM (success → {}, a business failure → { error },
 *     both at 200 — never a non-2xx-shaped RPC failure).
 *   - removeStaffPin: DELETE, no body; same verbatim-passthrough class.
 *   - enrollVoiceAction: POST multipart (FormData body, no explicit
 *     Content-Type); the body's OWN `ok` is read (never HTTP-status-only) —
 *     a core-level ownership denial still 200s with { ok: false }.
 *   - revokeVoiceAction: DELETE, no body; same body-level `ok` read.
 *   - createInvite: POST with an Idempotency-Key; success → { token }; a
 *     business-level { error } rides the 2xx body VERBATIM; a transport
 *     reject maps to { error: message }.
 *   - listInvites: GET; unwraps { invites } → InviteRow[]; ANY failure
 *     (403/500/transport reject) degrades to [] — web-exact, never throws.
 *   - revokeInvite: DELETE; { ok: true } | { error } rides the 2xx body
 *     VERBATIM.
 *
 * Fixtures are deliberately fake/inert (PIN '0000', a tiny synthetic audio
 * blob) — never a real credential value.
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import {
  setStaffPin,
  removeStaffPin,
  enrollVoiceAction,
  revokeVoiceAction,
  createInvite,
  listInvites,
  revokeInvite,
} from '../../../thin/ports/actions.vite'

describe('thin actions port — staff PIN', () => {
  it('setStaffPin: PUT to /api/app/v1/staff/[id]/pin, body { pin }, success → {}', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/staff/staff-9/pin')
      expect(init.method).toBe('PUT')
      expect(JSON.parse(init.body as string)).toEqual({ pin: '0000' })
      return new Response(JSON.stringify({}), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(setStaffPin('staff-9', '0000')).resolves.toEqual({})
  })

  it('setStaffPin: a business-level { error } (not-authorized) rides the 2xx body VERBATIM', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ error: 'Not authorized to set a PIN' }), { status: 200 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(setStaffPin('staff-9', '0000')).resolves.toEqual({
      error: 'Not authorized to set a PIN',
    })
  })

  it('setStaffPin: a transport reject maps to { error: message }', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(setStaffPin('staff-9', '0000')).resolves.toEqual({ error: 'Load failed' })
  })

  it('removeStaffPin: DELETE to /api/app/v1/staff/[id]/pin, no body, success → {}', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/staff/staff-9/pin')
      expect(init.method).toBe('DELETE')
      expect(init.body).toBeUndefined()
      return new Response(JSON.stringify({}), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(removeStaffPin('staff-9')).resolves.toEqual({})
  })

  it('removeStaffPin: a non-2xx failure maps to { error: message }', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ error: { message: 'core down' } }), { status: 502 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(removeStaffPin('staff-9')).resolves.toEqual({ error: 'core down' })
  })
})

describe('thin actions port — staff voice enrollment', () => {
  function fakeAudioForm(): FormData {
    // Synthetic, inert bytes — never a real recording.
    const fd = new FormData()
    fd.set('audio', new File([new Uint8Array([1, 2, 3])], 'voice.webm', { type: 'audio/webm' }))
    return fd
  }

  it('enrollVoiceAction: POST multipart to /api/app/v1/staff/[id]/voice, FormData passed through unchanged, success → { ok, enrolledAt }', async () => {
    const form = fakeAudioForm()
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/staff/staff-9/voice')
      expect(init.method).toBe('POST')
      expect(init.body).toBe(form) // passed through unchanged, not rewrapped
      // The browser sets the multipart Content-Type + boundary — the port
      // must never set it by hand.
      expect((init.headers as Record<string, string> | undefined)?.['Content-Type']).toBeUndefined()
      return new Response(JSON.stringify({ ok: true, enrolledAt: '2026-07-22T00:00:00.000Z' }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(enrollVoiceAction('staff-9', form)).resolves.toEqual({
      ok: true,
      enrolledAt: '2026-07-22T00:00:00.000Z',
    })
  })

  it('enrollVoiceAction: a body-level { ok: false } (core ownership denial) still 200s — read from the BODY, not HTTP status', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(enrollVoiceAction('staff-9', fakeAudioForm())).resolves.toEqual({ ok: false })
  })

  it('enrollVoiceAction: a non-2xx (validation failure) → { ok: false }', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ error: {} }), { status: 400 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(enrollVoiceAction('staff-9', fakeAudioForm())).resolves.toEqual({ ok: false })
  })

  it('enrollVoiceAction: a transport reject → { ok: false }, never throws', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(enrollVoiceAction('staff-9', fakeAudioForm())).resolves.toEqual({ ok: false })
  })

  it('revokeVoiceAction: DELETE to /api/app/v1/staff/[id]/voice, no body, success → { ok: true }', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/staff/staff-9/voice')
      expect(init.method).toBe('DELETE')
      expect(init.body).toBeUndefined()
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(revokeVoiceAction('staff-9')).resolves.toEqual({ ok: true })
  })

  it('revokeVoiceAction: a body-level { ok: false } (core ownership denial) still 200s — read from the BODY', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(revokeVoiceAction('staff-9')).resolves.toEqual({ ok: false })
  })

  it('revokeVoiceAction: a transport reject → { ok: false }, never throws', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(revokeVoiceAction('staff-9')).resolves.toEqual({ ok: false })
  })

  // The actor store clamp is the ONE refusal web names (`reason:
  // 'store_scope'`) so the dialog/list can say "not your branch" instead of
  // "upload failed" — the port carries that name across from the 403 body.
  const storeForbidden = () =>
    new Response(JSON.stringify({ error: { code: 'store_forbidden', message: 'nope' } }), { status: 403 })

  it('enrollVoiceAction: a 403 store_forbidden → { ok: false, reason: "store_scope" }', async () => {
    setDataPort({ apiFetch: jest.fn(storeForbidden) } as unknown as Parameters<typeof setDataPort>[0])
    await expect(enrollVoiceAction('staff-9', fakeAudioForm())).resolves.toEqual({
      ok: false,
      reason: 'store_scope',
    })
  })

  it('revokeVoiceAction: a 403 store_forbidden → { ok: false, reason: "store_scope" }', async () => {
    setDataPort({ apiFetch: jest.fn(storeForbidden) } as unknown as Parameters<typeof setDataPort>[0])
    await expect(revokeVoiceAction('staff-9')).resolves.toEqual({ ok: false, reason: 'store_scope' })
  })

  it('a 403 of a DIFFERENT class stays an unnamed { ok: false }', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ error: { code: 'forbidden' } }), { status: 403 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    await expect(revokeVoiceAction('staff-9')).resolves.toEqual({ ok: false })
  })
})

describe('thin actions port — staff invites', () => {
  it('createInvite: POST to /api/app/v1/invites with an Idempotency-Key header, success → { token }', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/invites')
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy()
      expect(JSON.parse(init.body as string)).toEqual({ email: 'newhire@example.com', role: 'STYLIST' })
      return new Response(JSON.stringify({ token: 'tok-abc' }), { status: 201 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(createInvite({ email: 'newhire@example.com', role: 'STYLIST' })).resolves.toEqual({
      token: 'tok-abc',
    })
  })

  it('createInvite: a business-level { error } (plan limit) rides the 2xx body VERBATIM', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ error: 'STAFF_LIMIT_REACHED' }), { status: 200 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(createInvite({ email: 'newhire@example.com', role: 'STYLIST' })).resolves.toEqual({
      error: 'STAFF_LIMIT_REACHED',
    })
  })

  it('createInvite: a transport reject maps to { error: message }', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(createInvite({ email: 'newhire@example.com', role: 'STYLIST' })).resolves.toEqual({
      error: 'Load failed',
    })
  })

  it('listInvites: GET /api/app/v1/invites, unwraps { invites }', async () => {
    const invites = [
      { id: 'inv-1', email: 'a@test.com', role: 'STYLIST', status: 'pending', created_at: '2026-01-01', expires_at: '2026-01-08' },
    ]
    const apiFetch = jest.fn(async (path: string) => {
      expect(path).toBe('/api/app/v1/invites')
      return new Response(JSON.stringify({ invites }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listInvites()).resolves.toEqual(invites)
  })

  it('listInvites: a 403 (missing staff.invite) degrades to [] — web-exact, never throws', async () => {
    const apiFetch = jest.fn(async () => new Response(JSON.stringify({ error: {} }), { status: 403 }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listInvites()).resolves.toEqual([])
  })

  it('listInvites: a transport reject degrades to [] — web-exact, never throws', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(listInvites()).resolves.toEqual([])
  })

  it('revokeInvite: DELETE to /api/app/v1/invites/[id], success → { ok: true }', async () => {
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      expect(path).toBe('/api/app/v1/invites/inv-9')
      expect(init.method).toBe('DELETE')
      expect(init.body).toBeUndefined()
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(revokeInvite('inv-9')).resolves.toEqual({ ok: true })
  })

  it('revokeInvite: a business-level { error } (SDK failure) rides the 2xx body VERBATIM', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ error: 'Could not revoke invite.' }), { status: 200 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(revokeInvite('inv-9')).resolves.toEqual({ error: 'Could not revoke invite.' })
  })

  it('revokeInvite: a transport reject maps to { error: message }', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(revokeInvite('inv-9')).resolves.toEqual({ error: 'Load failed' })
  })
})
