/**
 * ⚖ A2 (R-A2-2) — Karute's whole-snapshot org-settings writer never replays a key SYNQED
 * Business owns. Core merges a one-key PUT, so a key left out is kept; a key replayed from a
 * read taken before Business's save would silently revert Business's colour.
 */
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/staff', () => ({ getBusinessId: jest.fn(async () => 'biz-1') }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))

import { writeOrgSettingsBlobWithClient } from '@/actions/org-settings'

function clientReading(settings: Record<string, unknown>) {
  const upsert = jest.fn(async (_input: unknown) => ({}))
  const get = jest.fn(async () => ({ business_id: 'biz-1', name: 'Dev Salon', settings, created_at: '', updated_at: '' }))
  return { upsert, client: { orgSettings: { get, upsert } } as unknown as Parameters<typeof writeOrgSettingsBlobWithClient>[0] }
}

describe("Karute's org-settings writer and Business-owned keys", () => {
  it('a Karute save whose read holds reserve_card_color never sends it; every Karute key still replays', async () => {
    const { upsert, client } = clientReading({
      business_type: 'beauty',
      pack_presets: [{ size: 5, unitPrice: 1000 }],
      reserve_card_color: '#1C2247',
    })
    await expect(writeOrgSettingsBlobWithClient(client, { recording_disclosure_mode: 'B' })).resolves.toEqual({ success: true })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0]).toEqual({
      settings: { business_type: 'beauty', pack_presets: [{ size: 5, unitPrice: 1000 }], recording_disclosure_mode: 'B' },
    })
  })

  it('a read without the key: the PUT is exactly today’s replay + patch', async () => {
    const { upsert, client } = clientReading({ business_type: 'beauty', ticket_packs_enabled: true })
    await writeOrgSettingsBlobWithClient(client, { salon_name: 'New name', business_type: 'massage' })
    expect(upsert.mock.calls[0][0]).toEqual({ name: 'New name', settings: { business_type: 'massage', ticket_packs_enabled: true } })
  })
})
