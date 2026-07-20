/**
 * org-settings entry of the thin actions port (design-parity packet 12
 * §S1). Pins the TRANSPORT contract (#566 precedent, statusCall): an
 * offline/DNS reject from the DataPort must come back as the { error } shape
 * — every settings section awaits upsertOrgSettings WITHOUT a try/catch (see
 * OrganizationSection/ThemeSection/AISection/RecordingSection/PacksSection's
 * `save()` callbacks), so a rejection would strand `saving` state / drop the
 * toast silently.
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { upsertOrgSettings } from '../../../thin/ports/actions.vite'

describe('thin actions port — org-settings transport contract', () => {
  it('maps a transport reject to { error }', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed') // WebKit's offline fetch reject
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const result = await upsertOrgSettings({ salon_name: 'New name' })
    expect(result).toEqual({ error: 'Load failed' })
  })

  it('rides the facade\'s 2xx body verbatim on success', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(upsertOrgSettings({ salon_name: 'New name' })).resolves.toEqual({ success: true })
  })

  it('rides a business-level { error } body verbatim (non-2xx-shaped RPC failure)', async () => {
    const apiFetch = jest.fn(
      async () => new Response(JSON.stringify({ error: 'Open and close times must be valid times.' }), { status: 200 }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(upsertOrgSettings({ operating_hours: {} })).resolves.toEqual({
      error: 'Open and close times must be valid times.',
    })
  })

  it('a non-2xx transport/auth failure maps to the facade error envelope message', async () => {
    const apiFetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Missing capability: settings.manage' } }), {
          status: 403,
        }),
    )
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    await expect(upsertOrgSettings({ salon_name: 'x' })).resolves.toEqual({
      error: 'Missing capability: settings.manage',
    })
  })
})
