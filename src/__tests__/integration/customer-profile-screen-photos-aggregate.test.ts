/**
 * buildCustomerProfileScreen — photos stay the CUSTOMER AGGREGATE, never
 * karute-scoped (packet 2026-08-09 PR 9a §F regression pin). Scoping by
 * recording_session_id is a KARUTE-detail-only rule (scopeKarutePhotos,
 * consumed by screens/karute/[id]/route.ts + PhotoRecordsServer); the
 * customer/device profile screen must keep showing every photo regardless of
 * which session (or no session at all) it was taken in — dto.photos is a
 * verbatim carry of screen.photos (see customer-profile-screen-dto.ts), so
 * pinning the builder's output pins the route's response too.
 *
 * Direct builder test — the facade route test
 * (app-api-customer-profile-screen.test.ts) mocks this builder entirely, same
 * as customer-profile-screen-staff-translation.test.ts, whose harness this
 * copies.
 */
import type { BuildCustomerProfileScreenArgs } from '@/lib/customers/profile-screen'

jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class SynqedError extends Error {},
}))
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

import { buildCustomerProfileScreen } from '@/lib/customers/profile-screen'

const CUSTOMER = {
  id: 'cust-1',
  name: '山田 花子',
  furigana: null,
  phone: null,
  email: null,
  notes: null,
  assigned_staff_id: null,
  is_existing_customer: true,
  date_of_birth: null,
  gender: null,
  occupation: null,
  member_number: null,
  visit_count: 1,
  has_ticket_pack: false,
  last_visit_at: null,
  first_visit_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  deleted_at: null,
} as unknown as BuildCustomerProfileScreenArgs['customer']

function args(
  over: Partial<BuildCustomerProfileScreenArgs>,
): BuildCustomerProfileScreenArgs {
  return {
    customer: CUSTOMER,
    id: 'cust-1',
    businessId: 'biz-1',
    locale: 'ja',
    contact: { phone: null, email: null },
    staffList: [
      { id: 'profile-9', full_name: '田中' } as unknown as BuildCustomerProfileScreenArgs['staffList'][number],
    ],
    photosResult: { photos: [] },
    allCustomersList: { customers: [CUSTOMER], total: 1 } as unknown as BuildCustomerProfileScreenArgs['allCustomersList'],
    synqedKaruteRows: [],
    synqedStaff: { staff: [{ id: 'sstaff-9', user_id: 'profile-9' }] },
    enrichment: new Map(),
    consentResult: { consent: null },
    memoryItemsRead: [],
    aiPassport: null,
    orgSettingsForPassport: null,
    lifecycleRead: { ok: false } as unknown as BuildCustomerProfileScreenArgs['lifecycleRead'],
    packs: [],
    ...over,
  }
}

describe('profile screen photos — customer aggregate stays unfiltered (packet PR 9a §F)', () => {
  it('a mixed-session photo list (different sessions + null) all reach the screen unfiltered', async () => {
    // customer surfaces are the aggregate; scoping is karute-only — this
    // builder must never filter by recording_session_id.
    const mixedPhotos = [
      { id: 'p1', signed_url: 'https://x/p1', category: 'before', caption: null, recording_session_id: 'sess-1' },
      { id: 'p2', signed_url: 'https://x/p2', category: 'after', caption: null, recording_session_id: 'sess-2' },
      { id: 'p3', signed_url: 'https://x/p3', category: 'reference', caption: null, recording_session_id: null },
    ]
    const screen = await buildCustomerProfileScreen(
      args({
        photosResult: {
          photos: mixedPhotos,
        } as unknown as BuildCustomerProfileScreenArgs['photosResult'],
      }),
    )
    expect(screen.photos.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })
})
