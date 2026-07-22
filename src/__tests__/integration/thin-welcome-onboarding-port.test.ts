/**
 * completeOnboarding entry of the thin actions port (design-parity packet
 * 21). Pins: the 3 validation branches mirror the web action's EXACT
 * strings (src/actions/org-settings.ts:217-221) and fire ZERO apiFetch
 * calls (a client-side reject must never reach the network) · on pass, the
 * write rides through facadeUpsertOrgSettings with the 5-field payload
 * (name trimmed, setup_completed_at stamped) and its result comes back
 * verbatim.
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { completeOnboarding } from '../../../thin/ports/actions.vite'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe('thin actions port — completeOnboarding (welcome wizard)', () => {
  it('empty/whitespace store name → the exact web validation string, zero apiFetch calls', async () => {
    const apiFetch = jest.fn()
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(
      completeOnboarding({
        businessName: '   ',
        businessType: 'hair_salon',
        disclosureMode: 'B',
        privacyConfirmed: false,
      }),
    ).resolves.toEqual({ error: 'Store name is required' })
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('no business type → the exact web validation string, zero apiFetch calls', async () => {
    const apiFetch = jest.fn()
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(
      completeOnboarding({
        businessName: 'La Estro',
        businessType: '',
        disclosureMode: 'B',
        privacyConfirmed: false,
      }),
    ).resolves.toEqual({ error: 'Business type is required' })
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('mode A without privacy confirmation → the exact web validation string, zero apiFetch calls', async () => {
    const apiFetch = jest.fn()
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(
      completeOnboarding({
        businessName: 'La Estro',
        businessType: 'hair_salon',
        disclosureMode: 'A',
        privacyConfirmed: false,
      }),
    ).resolves.toEqual({
      error: 'Privacy policy confirmation required for Mode A',
    })
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('on pass, PATCHes org-settings with the 5-field payload (name trimmed, ISO timestamp) and rides the result verbatim', async () => {
    const apiFetch = jest.fn(async (_path: string, _init: RequestInit) => jsonResponse({ success: true }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const before = Date.now()
    const result = await completeOnboarding({
      businessName: '  La Estro  ',
      businessType: 'hair_salon',
      disclosureMode: 'B',
      privacyConfirmed: false,
    })
    expect(result).toEqual({ success: true })

    expect(apiFetch).toHaveBeenCalledTimes(1)
    const [path, init] = apiFetch.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/app/v1/org-settings')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      salon_name: 'La Estro',
      business_type: 'hair_salon',
      recording_disclosure_mode: 'B',
      recording_disclosure_privacy_confirmed: false,
    })
    expect(typeof body.setup_completed_at).toBe('string')
    expect(new Date(body.setup_completed_at).toISOString()).toBe(body.setup_completed_at)
    expect(new Date(body.setup_completed_at).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('mode A WITH privacy confirmation passes validation and includes the confirmed flag', async () => {
    const apiFetch = jest.fn(async (_path: string, _init: RequestInit) => jsonResponse({ success: true }))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await completeOnboarding({
      businessName: 'La Estro',
      businessType: 'hair_salon',
      disclosureMode: 'A',
      privacyConfirmed: true,
    })
    const [, init] = apiFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.recording_disclosure_mode).toBe('A')
    expect(body.recording_disclosure_privacy_confirmed).toBe(true)
  })

  it('a transport reject on the pass-through write still maps to { error } (#566 precedent)', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(
      completeOnboarding({
        businessName: 'La Estro',
        businessType: 'hair_salon',
        disclosureMode: 'B',
        privacyConfirmed: false,
      }),
    ).resolves.toEqual({ error: 'Load failed' })
  })
})
