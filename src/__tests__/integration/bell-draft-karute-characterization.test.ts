/**
 * R3 — 未保存カルテ bell CHARACTERIZATION (Build F1 packet, step 1).
 *
 * The packet asked whether the 24 h age gate on the bell's 未保存カルテ roll-up
 * could safely drop to 0 so a recording-origin record is announced the moment
 * it saves. The rule it set: pin the bell's REAL behaviour first, and only drop
 * the gate IF buildDraftKarute's input is bounded.
 *
 * IT IS NOT. Three facts, each pinned below:
 *   1. NOTHING in the app ever writes a karute status other than 'DRAFT' —
 *      there is no REVIEW/APPROVED write anywhere, so a record never leaves
 *      DRAFT once created.
 *   2. The feeder (getCachedDraftKarute) lists status:'DRAFT' with NO from/to
 *      window at all — up to 25 × 200 rows of the tenant's ENTIRE history.
 *   3. The only thing bounding the rendered count is the dedupe-by-customer,
 *      so the number the bell shows already grows with the customer book, and
 *      the age gate removes only the last day.
 *
 * ⇒ VERDICT: the bell is NOT changed. Dropping the gate would add the newest
 * day to a count that is already "every customer who has ever had a karute" —
 * motion, not immediacy. Immediacy is delivered client-side instead by the
 * 要対応 badge (Build F1), which counts only recordings that genuinely owe the
 * staffer something and decays to zero when they are handled.
 *
 * These tests exist so a future edit has to face the finding before touching
 * DRAFT_MIN_AGE_MS.
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  assembleNotificationFeed,
  DRAFT_MIN_AGE_MS,
  type AssembleFeedInputs,
} from '@/lib/notifications/derive-core'

const NOW = new Date('2026-08-25T12:00:00+09:00')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

const HREFS = {
  agenda: '/ja/appointments',
  customers: '/ja/customers',
  customersFollowup: '/ja/customers',
  customersSyncPending: '/ja/customers',
  karute: '/ja/karute',
}

function draftItem(drafts: AssembleFeedInputs['drafts']) {
  return assembleNotificationFeed({
    now: NOW,
    hrefs: HREFS,
    todayAppointments: [],
    recentBookings: [],
    chase: { needsFollowup: 0, dormant: 0 },
    drafts,
    syncPendingCount: 0,
  }).find((i) => i.id === 'draft-karute-rollup')
}

const SRC = path.resolve(__dirname, '../../..', 'src')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__') continue
      out.push(...sourceFiles(p))
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

describe('R3 — the bell’s 未保存カルテ input is UNBOUNDED', () => {
  it('nothing app-side ever promotes a record out of DRAFT', () => {
    // The premise the whole "DRAFT = unreviewed" reading rests on. If this ever
    // fails, someone shipped a REVIEW/APPROVED write and R3 must be re-decided.
    const offenders = sourceFiles(SRC).filter((f) =>
      /status:\s*['"](REVIEW|APPROVED)['"]/.test(fs.readFileSync(f, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('the feeder asks for the tenant’s WHOLE DRAFT history — no date window', () => {
    const feeder = fs.readFileSync(path.join(SRC, 'lib/notifications/derive.ts'), 'utf8')
    const call = feeder.slice(
      feeder.indexOf('karuteRecords.list({'),
      feeder.indexOf('karuteRecords.list({') + 260,
    )
    expect(call).toContain("status: 'DRAFT'")
    expect(call).not.toContain('from:')
    expect(call).not.toContain('to:')
  })

  it('a THREE-YEAR-OLD draft still counts — age only ever excludes the newest day', () => {
    const item = draftItem([
      { customerId: 'c1', createdAt: daysAgo(1100) },
      { customerId: 'c2', createdAt: daysAgo(400) },
      { customerId: 'c3', createdAt: daysAgo(2) },
    ])
    expect(item?.titleJa).toBe('未保存カルテ 3件')
  })

  it('the count is bounded only by the CUSTOMER BOOK, which grows without limit', () => {
    const many = Array.from({ length: 634 }, (_, i) => ({
      customerId: `cust-${i}`,
      createdAt: daysAgo(30),
    }))
    expect(draftItem(many)?.titleJa).toBe('未保存カルテ 634件')
  })
})

describe('R3 — the bell is DELIBERATELY unchanged', () => {
  it('the 24 h age gate stands', () => {
    expect(DRAFT_MIN_AGE_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('a record saved minutes ago is still NOT announced by the bell', () => {
    // Immediacy for a just-saved recording is the 要対応 badge's job
    // (lib/recordings/inbox), not this roll-up's.
    expect(draftItem([{ customerId: 'c1', createdAt: daysAgo(0.01) }])).toBeUndefined()
  })

  it('it stays ONE count-only roll-up, deduped by customer — never a per-record stream', () => {
    const item = draftItem([
      { customerId: 'c1', createdAt: daysAgo(3) },
      { customerId: 'c1', createdAt: daysAgo(4) },
      { customerId: 'c1', createdAt: daysAgo(5) },
    ])
    expect(item?.titleJa).toBe('未保存カルテ 1件')
    expect(item?.bodyJa).toBe('過去セッションの下書き')
  })
})
