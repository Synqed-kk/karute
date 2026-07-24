/**
 * buildCustomerProfileScreen — karute-history 担当 id-space translation
 * (Liam field report 7/24: the recording pipeline stamps the SYNQED staff id
 * on core karute rows while interactive saves stamp the profile id; the
 * profile screen's name join was profile-keyed only, so pipeline-written
 * records rendered 担当 "Unknown"). Direct builder test — the facade route
 * test mocks this builder entirely, so the derivation is pinned here.
 */
import type { BuildCustomerProfileScreenArgs } from '@/lib/customers/profile-screen'

// Untransformed ESM package — stub it (same idiom as every sibling suite;
// the builder only touches the SDK through types + injected data).
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

const karuteRow = (staffId: string) =>
  ({
    id: `kar-${staffId}`,
    client_id: 'cust-1',
    created_at: '2026-07-24T03:00:00Z',
    session_date: '2026-07-24T03:00:00Z',
    summary: 'x',
    transcript: 't',
    staff_profile_id: staffId,
    entries: [{ count: 1 }],
    service: null,
    duration_minutes: 2,
  }) as unknown as BuildCustomerProfileScreenArgs['synqedKaruteRows'][number]

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

describe('profile screen karute history — staff id-space translation (7/24)', () => {
  it('a pipeline-written row (SYNQED staff id) resolves the 担当 name via the roster link', async () => {
    const screen = await buildCustomerProfileScreen(
      args({ synqedKaruteRows: [karuteRow('sstaff-9')] }),
    )
    // Before the boundary translation this was 'Unknown' — the live
    // ぴあそんりえむ repro from Liam's phone.
    expect(screen.sessions[0].staffName).toBe('田中')
  })

  it('a legacy interactive-save row (profile id) still resolves', async () => {
    const screen = await buildCustomerProfileScreen(
      args({ synqedKaruteRows: [karuteRow('profile-9')] }),
    )
    expect(screen.sessions[0].staffName).toBe('田中')
  })

  it('synqedStaff null (roster fetch failed) degrades to Unknown for synqed-id rows — never crashes', async () => {
    const screen = await buildCustomerProfileScreen(
      args({ synqedKaruteRows: [karuteRow('sstaff-9')], synqedStaff: null }),
    )
    expect(screen.sessions[0].staffName).toBe('Unknown')
  })
})
