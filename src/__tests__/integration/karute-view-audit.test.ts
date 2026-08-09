/**
 * karute.view — web twin (Wave V): a single-record open of
 * karute/[id]/page.tsx emits ONE karute.view event, AFTER the record is
 * confirmed to exist (a 404 open is not a view — the same 7/17 ruling
 * customer-view-audit.test.ts pins), carrying the canon-mandated
 * transcript_shown flag as what THIS render actually shipped (false covers
 * both "none exists" and "ACL-withheld to null"). Harness is the
 * customer-view-audit.test.ts idiom: every dependency mocked, only the audit
 * spine (@/lib/audit + @/lib/staff's identity resolvers) runs for real,
 * spied via console. The facade twin's emit (the hook + ctx.auditDetail) is
 * pinned in facade-audit.test.ts.
 */
jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
  resolveUserId: jest.fn(async () => 'user-1'),
}))
jest.mock('@/lib/supabase/karute', () => ({
  getKaruteRecord: jest.fn(async (id: string) =>
    id === 'missing' ? null : { id, client_id: 'cust-9', summary: null },
  ),
}))
jest.mock('@/lib/karute/outcome', () => ({ getKaruteOutcome: jest.fn(async () => null) }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(async () => ({})) }))
jest.mock('@/lib/auth/require-permission', () => ({ can: jest.fn(async () => false) }))
jest.mock('@/lib/customers/list-all', () => ({
  listAllCustomers: jest.fn(async () => ({ customers: [] })),
}))
jest.mock('@/lib/customers/queries', () => ({ getCustomer: jest.fn(async () => null) }))
jest.mock('@/lib/customers/customer-detail-cached', () => ({
  getCustomerContact: jest.fn(async () => null),
  getCachedCustomerConsent: jest.fn(async () => ({ consent: null })),
}))
jest.mock('@/components/karute/redesign/detail/KaruteDetailView', () => ({
  KaruteDetailView: () => null,
}))
jest.mock('@/components/karute/redesign/detail/PhotoRecordsServer', () => ({
  PhotoRecordsServer: () => null,
}))
jest.mock('@/components/karute/redesign/detail/AiInsightSlots', () => ({
  AIBodyPredictionSlot: () => null,
  AISuggestedMessageSlot: () => null,
}))
jest.mock('@/components/customers/redesign/profile/UpcomingAiFeatures', () => ({
  AIBodyPredictionPreview: () => null,
  AIOutreachPreview: () => null,
}))
jest.mock('@/lib/karute/detail-screen', () => ({ buildKaruteDetailScreen: jest.fn() }))

import { auditLines } from './helpers/audit-lines'
import { buildKaruteDetailScreen } from '@/lib/karute/detail-screen'
import KaruteDetailPage from '@/app/[locale]/(app)/karute/[id]/page'

// The minimal built shape the page dereferences on its way to the (mocked)
// view component — transcript is the field under test.
function builtWith(transcript: string | null) {
  return {
    karuteId: 'k-1',
    customerId: null,
    outcome: null,
    header: { customerName: null },
    sessionDateLong: '',
    sessionDateIso: '',
    entries: [],
    summaryBullets: [],
    transcript,
    consentOnFile: false,
    transcriptDurationLabel: null,
    transcriptRestricted: false,
  }
}

// Drain the fire-and-forget auditWeb chain deterministically before asserting —
// same reasoning as customer-view-audit.test.ts's drain.
const drain = () => new Promise((r) => setImmediate(r))

describe('karute.view — single-record open (web twin)', () => {
  it('emits exactly one karute.view with transcript_shown:true when the transcript shipped', async () => {
    ;(buildKaruteDetailScreen as jest.Mock).mockReturnValueOnce(builtWith('raw transcript text'))
    const lines = await auditLines(async () => {
      await KaruteDetailPage({ params: Promise.resolve({ id: 'k-1', locale: 'ja' }) })
      await drain()
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'karute',
      action: 'karute.view',
      actor_id: 'user-1',
      business_id: 'biz-1',
      target_type: 'karute',
      target_id: 'k-1',
      severity: 'info',
      source: 'web',
    })
    // customer_id rides in detail for the 監査ログ name join (packet 30 §4).
    expect(lines[0].detail).toEqual({ transcript_shown: true, customer_id: 'cust-9' })
  })

  it('transcript_shown:false when the DTO carries no transcript (none exists OR ACL-withheld)', async () => {
    ;(buildKaruteDetailScreen as jest.Mock).mockReturnValueOnce(builtWith(null))
    const lines = await auditLines(async () => {
      await KaruteDetailPage({ params: Promise.resolve({ id: 'k-2', locale: 'ja' }) })
      await drain()
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ action: 'karute.view', target_id: 'k-2' })
    expect(lines[0].detail).toEqual({ transcript_shown: false, customer_id: 'cust-9' })
  })

  it('a 404 open (record does not exist) emits nothing — a missing record is not a view', async () => {
    const lines = await auditLines(async () => {
      await expect(
        KaruteDetailPage({ params: Promise.resolve({ id: 'missing', locale: 'ja' }) }),
      ).rejects.toThrow('NEXT_NOT_FOUND')
      await drain()
    })
    expect(lines).toHaveLength(0)
  })
})
