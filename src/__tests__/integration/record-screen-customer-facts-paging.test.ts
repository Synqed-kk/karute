/**
 * R4 — customerFacts paging VERIFICATION (Build F1 packet).
 *
 * The packet asked whether the 録音 picker's customerFacts silently truncates
 * at core's 500-row page clamp, the way un-paged SDK lists have before. The
 * expected answer was "already correct" — this suite is the evidence for that
 * verdict rather than an assertion of it, and the guard that keeps it true.
 *
 * VERDICT: NO-OP. customerFacts is a `.map()` over the `customers` array the
 * CALLER injects, and both callers page to completion before handing it over:
 *   · web  — sessions/page.tsx → getCachedCustomerList() (cached.ts, paginateDedupe)
 *   · thin — screens/record/route.ts → listAllCustomers() (list-all.ts, paginateDedupe)
 * There is no list read inside record-screen.ts to truncate, and no cap on the
 * map. Nothing was changed.
 */
import * as fs from 'fs'
import * as path from 'path'
import { buildRecordScreen } from '@/lib/karute/record-screen'
import type { CustomerWithStaff } from '@/lib/customers/queries'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('R4 — customerFacts is fed an already-paged list', () => {
  it('record-screen.ts reads NO customer list of its own', () => {
    const src = read('src/lib/karute/record-screen.ts')
    expect(src).not.toContain('customers.list(')
    expect(src).not.toContain('page_size')
    // …and the facts are a plain map over the injected array, uncapped.
    expect(src).toContain('customerFacts = customers.map(')
    expect(src).not.toMatch(/customers\.slice\(/)
  })

  it('the WEB caller pages to completion (getCachedCustomerList → paginateDedupe)', () => {
    expect(read('src/app/[locale]/(app)/sessions/page.tsx')).toContain(
      'getCachedCustomerList()',
    )
    expect(read('src/lib/customers/cached.ts')).toContain('await paginateDedupe(')
  })

  it('the FACADE caller pages to completion (listAllCustomers → paginateDedupe)', () => {
    expect(read('src/app/api/app/v1/screens/record/route.ts')).toContain('listAllCustomers(')
    expect(read('src/lib/customers/list-all.ts')).toContain('await paginateDedupe(')
  })

  it('behaviourally: 600 customers in → 600 facts out (no 500-row cliff)', async () => {
    const customers = Array.from({ length: 600 }, (_, i) => ({
      id: `c-${i}`,
      name: `顧客 ${i}`,
      phone: null,
      furigana: null,
      isExistingCustomer: false,
      created_at: '2026-01-01T00:00:00.000Z',
      visitCount: 0,
      hasTicketPack: false,
      karute_number: i + 1,
    }))
    const screen = await buildRecordScreen({
      locale: 'ja',
      now: new Date('2026-08-25T02:00:00.000Z'),
      activeStaffId: 's-me',
      staffList: [{ id: 's-me', full_name: '原' }],
      customers,
      todayAppts: [], // no booking → no target → the picker (and facts) exist
      orgSettings: null,
      statusLabel: () => '',
      deps: {
        resolveExplicitAppointment: async () => null,
        resolveWalkInCustomer: async () => null as CustomerWithStaff | null,
        getTargetCustomer: async () => null,
        getConsent: async () => null,
        getKaruteRecords: async () => [],
        listPacks: async () => [],
        getLifecycle: async () => ({ ok: true as const, lifecycle: null }),
      },
    })
    expect(screen.customerFacts).toHaveLength(600)
    expect(screen.customerFacts[599].id).toBe('c-599')
  })
})
