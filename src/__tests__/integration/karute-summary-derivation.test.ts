// Edit-layer W2 summary half (blind-round test lens): the record→screen→DTO
// derivation seam for the 詳細記録 pencil, which shipped with the UI end
// pinned but the data end unpinned. Pins: summary_edited comes from the
// PRESENCE of the overlay (not its truthiness vs ai_summary); summaryRaw is
// the EFFECTIVE text (edited wins over ai — a mutant sourcing ai_summary
// would seed the device sheet with stale AI text over the human overlay);
// the DTO parses the builder's output with the new fields, and still parses
// a legacy payload WITHOUT them (server-rollback compat, the
// SessionEntrySchema .optional() precedent).
jest.mock('@synqed-kk/client', () => ({}))

import { mapSynqedKaruteRecord } from '@/lib/supabase/karute'
import { buildKaruteDetailScreen } from '@/lib/karute/detail-screen'
import { KaruteDetailScreenDTO } from '@/lib/app-api/karute-detail-screen-dto'

const baseRec = {
  id: 'kar-1',
  created_at: '2026-07-29T10:00:00.000Z',
  ai_summary: '・AIの行\n・二行目',
  transcript: null,
  business_id: 'biz-1',
  customer_id: 'cust-1',
  staff_id: 'staff-1',
  entries: [],
}

const buildArgs = (karute: ReturnType<typeof mapSynqedKaruteRecord>) => ({
  karute,
  allCustomers: { customers: [{ id: 'cust-1' }] },
  outcome: null,
  viewerStaffId: 'staff-1',
  canViewAllRecordings: false,
  recordingRow: null,
  businessId: 'biz-1',
  staffCanReassignRecords: false,
  contact: null,
  consentResult: null,
  customer: null,
  locale: 'ja',
})

describe('summary derivation seam (mapper → builder → DTO)', () => {
  it('no overlay: summaryRaw = ai text, summaryEdited = false', () => {
    const karute = mapSynqedKaruteRecord({ ...baseRec, edited_summary: null }, null)
    expect(karute.summary).toBe('・AIの行\n・二行目')
    expect(karute.summary_edited).toBe(false)
    const built = buildKaruteDetailScreen(buildArgs(karute))
    expect(built.summaryRaw).toBe('・AIの行\n・二行目')
    expect(built.summaryEdited).toBe(false)
  })

  it('overlay present: summaryRaw = the HUMAN text (edited wins), summaryEdited = true', () => {
    const karute = mapSynqedKaruteRecord(
      { ...baseRec, edited_summary: '・人間の直し' },
      null,
    )
    expect(karute.summary).toBe('・人間の直し')
    expect(karute.summary_edited).toBe(true)
    const built = buildKaruteDetailScreen(buildArgs(karute))
    // A mutant sourcing summaryRaw from ai_summary would seed the sheet with
    // stale AI text over the overlay — the exact overwrite semantics the
    // pencil exists to protect.
    expect(built.summaryRaw).toBe('・人間の直し')
    expect(built.summaryEdited).toBe(true)
  })

  it('the DTO parses the builder output with the new fields, and a legacy payload WITHOUT them (rollback compat)', () => {
    const karute = mapSynqedKaruteRecord({ ...baseRec, edited_summary: '・人間の直し' }, null)
    const built = buildKaruteDetailScreen(buildArgs(karute))
    const withFields = KaruteDetailScreenDTO.parse({ ...built, photos: [], viewerRole: 'staff' })
    expect(withFields.summaryRaw).toBe('・人間の直し')
    expect(withFields.summaryEdited).toBe(true)

    // A pre-pencil server's payload lacks both keys — the parse must degrade
    // (read-only card), never fail the whole screen.
    const { summaryRaw: _r, summaryEdited: _e, ...legacy } = {
      ...built,
      photos: [],
      viewerRole: 'staff',
    }
    const parsed = KaruteDetailScreenDTO.parse(legacy)
    expect(parsed.summaryRaw).toBeUndefined()
    expect(parsed.summaryEdited).toBeUndefined()
  })
})
