/**
 * ⚖ A2 (R-A2-2) — Karute's whole-snapshot org-settings writer never replays a key SYNQED
 * Business owns. Core merges a one-key PUT, so a key left out is kept; a key replayed from a
 * read taken before Business's save would silently revert Business's colour.
 * ⚖ PKT-S38 R5 — and 予約の色分け's `booking_colors` the same way.
 */
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))
jest.mock('@/lib/staff', () => ({ getBusinessId: jest.fn(async () => 'biz-1') }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))

import { writeOrgSettingsBlobWithClient } from '@/actions/org-settings'

/** A stateful fake of core's org-settings row. 'merge' = core's PUT: synqed-core
 *  src/services/org-settings.service.ts:50 (origin/main 3dcafd715), inside the upsert's
 *  ON CONFLICT: `settings = org_settings.settings || EXCLUDED.settings,` — a jsonb shallow
 *  merge, so a key the PUT leaves out is kept. 'replace' = a core that swapped the whole
 *  object instead: the behaviour the omission must NOT be paired with. */
function clientReading(initial: Record<string, unknown>, core: 'merge' | 'replace' = 'merge') {
  let settings = initial
  const row = () => ({ business_id: 'biz-1', name: 'Dev Salon', settings, created_at: '', updated_at: '' })
  const upsert = jest.fn(async (input: { settings?: Record<string, unknown> }) => {
    if (input.settings) settings = core === 'merge' ? { ...settings, ...input.settings } : input.settings
    return row()
  })
  const get = jest.fn(async () => row())
  return { upsert, get, client: { orgSettings: { get, upsert } } as unknown as Parameters<typeof writeOrgSettingsBlobWithClient>[0] }
}

/** ⚖ PKT-S38 R5 — every key Business owns: the card colour (A2) and 予約の色分け's per-store map. */
const BUSINESS_OWNED: Array<[string, unknown]> = [
  ['reserve_card_color', '#1C2247'],
  ['booking_colors', { 'aa36d5fe-8e35-46bb-8c9b-ac92a8aa816f': { new: '#3b6fd4', repeat: '#8a63b8', ticket: '#2f8f8f', vip: '#3f3f46' } }],
]

describe("Karute's org-settings writer and Business-owned keys", () => {
  it.each(BUSINESS_OWNED)('a Karute save whose read holds %s never sends it; every Karute key still replays', async (key, value) => {
    const { upsert, client } = clientReading({
      business_type: 'beauty',
      pack_presets: [{ size: 5, unitPrice: 1000 }],
      [key]: value,
    })
    await expect(writeOrgSettingsBlobWithClient(client, { recording_disclosure_mode: 'B' })).resolves.toEqual({ success: true })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0]).toEqual({
      settings: { business_type: 'beauty', pack_presets: [{ size: 5, unitPrice: 1000 }], recording_disclosure_mode: 'B' },
    })
    // The resulting state: Karute's omission + core's merge ⇒ Business's value survives a Karute save.
    expect((await client.orgSettings.get())?.settings).toEqual({
      business_type: 'beauty',
      pack_presets: [{ size: 5, unitPrice: 1000 }],
      [key]: value,
      recording_disclosure_mode: 'B',
    })
  })

  it('a read holding BOTH Business keys: the PUT carries neither', async () => {
    const { upsert, client } = clientReading({ business_type: 'beauty', ...Object.fromEntries(BUSINESS_OWNED) })
    await writeOrgSettingsBlobWithClient(client, { recording_disclosure_mode: 'B' })
    expect(upsert.mock.calls[0][0]).toEqual({ settings: { business_type: 'beauty', recording_disclosure_mode: 'B' } })
  })

  it('the fix relies on core MERGING: under a whole-object replace the omitted colour would be gone', async () => {
    const stored = { business_type: 'beauty', reserve_card_color: '#1C2247' }
    for (const [core, kept] of [['merge', true], ['replace', false]] as const) {
      const { client } = clientReading(stored, core)
      await writeOrgSettingsBlobWithClient(client, { recording_disclosure_mode: 'B' })
      expect('reserve_card_color' in ((await client.orgSettings.get())?.settings ?? {})).toBe(kept)
    }
  })

  it('a read without the key: the PUT is exactly today’s replay + patch', async () => {
    const { upsert, client } = clientReading({ business_type: 'beauty', ticket_packs_enabled: true })
    await writeOrgSettingsBlobWithClient(client, { salon_name: 'New name', business_type: 'massage' })
    expect(upsert.mock.calls[0][0]).toEqual({ name: 'New name', settings: { business_type: 'massage', ticket_packs_enabled: true } })
  })
})
