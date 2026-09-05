/**
 * F4 §5 pin 8a — staffCanReassignRecords flag threading, the shared
 * chokepoint: buildKaruteDetailScreen (BOTH the web page and the facade GET
 * route funnel through this SAME function) passes the arg straight through
 * to the returned screen, unchanged, additive-only (no other field
 * reshaped). The web-page half (pin 8b) is
 * reassign-flag-threading-web-page.test.ts — split into its own file because
 * that suite mocks '@/lib/karute/detail-screen' itself (jest.mock hoists to
 * the top of a FILE, not a describe block — the two halves cannot share a
 * module). The facade-GET half is pinned in
 * app-api-karute-detail-screen.test.ts.
 */
jest.mock('@synqed-kk/client', () => ({}))

import { buildKaruteDetailScreen, type BuildKaruteDetailScreenArgs } from '@/lib/karute/detail-screen'
import type { KaruteWithRelations } from '@/lib/supabase/karute'

const baseArgs: BuildKaruteDetailScreenArgs = {
  karute: {
    id: 'kar-1',
    client_id: 'cust-1',
    created_at: '2026-06-01T00:00:00Z',
  } as unknown as KaruteWithRelations,
  allCustomers: { customers: [{ id: 'cust-1' }] },
  outcome: null,
  viewerStaffId: null,
  canViewAllRecordings: false,
  recordingRow: null,
  canHearAll: false,
  businessId: 'biz-1',
  staffCanReassignRecords: false,
  contact: null,
  consentResult: null,
  customer: null,
  locale: 'ja',
}

describe('buildKaruteDetailScreen — staffCanReassignRecords (pin 8a, shared chokepoint)', () => {
  it('passes true straight through, unchanged', () => {
    const screen = buildKaruteDetailScreen({ ...baseArgs, staffCanReassignRecords: true })
    expect(screen.staffCanReassignRecords).toBe(true)
  })

  it('passes false straight through, unchanged', () => {
    const screen = buildKaruteDetailScreen({ ...baseArgs, staffCanReassignRecords: false })
    expect(screen.staffCanReassignRecords).toBe(false)
  })

  it('is additive-only — every other field is unaffected by the flag value', () => {
    const withFlag = buildKaruteDetailScreen({ ...baseArgs, staffCanReassignRecords: true })
    const withoutFlag = buildKaruteDetailScreen({ ...baseArgs, staffCanReassignRecords: false })
    const strip = ({ staffCanReassignRecords: _drop, ...rest }: typeof withFlag) => rest
    expect(strip(withFlag)).toEqual(strip(withoutFlag))
  })
})
