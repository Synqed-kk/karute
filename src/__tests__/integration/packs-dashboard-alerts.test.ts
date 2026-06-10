import { computePackAlerts } from '@/lib/packs/alerts-core'
import type { CustomerPackUsage } from '@/lib/packs/store'

// Dashboard 離客アラート assembly — same resolver as the 顧客 list (chopstick),
// plus the dashboard-specific rules: manager dismissals silence CONTACT only,
// 卒業/離客 excluded, most-days-absent first.

const NOW = new Date('2026-06-10T12:00:00Z')
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString()

const usage = (remaining: number, size = 10): CustomerPackUsage => ({
  remaining,
  size,
  unconsumed: remaining * 9900,
  hasActivePack: true,
})

function build(over: Partial<Parameters<typeof computePackAlerts>[0]> = {}) {
  return computePackAlerts({
    usage: new Map([
      ['c-risk', usage(8)], // 78 days absent, no booking → contact
      ['c-fine', usage(5)], // visited 3 days ago, has booking → nothing
      ['c-low', usage(1, 6)], // 残り1回, has booking → low
    ]),
    lifecycles: new Map(),
    dismissed: new Set(),
    nameById: new Map([
      ['c-risk', '田中一'],
      ['c-fine', '佐藤二'],
      ['c-low', '鈴木三'],
    ]),
    visitById: new Map([
      ['c-risk', { lastVisitIso: daysAgo(78), nextAppointmentIso: null }],
      ['c-fine', { lastVisitIso: daysAgo(3), nextAppointmentIso: daysAgo(-2) }],
      ['c-low', { lastVisitIso: daysAgo(5), nextAppointmentIso: daysAgo(-7) }],
    ]),
    karuteNumberById: new Map([['c-risk', '#00017']]),
    now: NOW,
    ...over,
  })
}

describe('computePackAlerts (dashboard 離客/upsell assembly)', () => {
  it('splits contact vs low and leaves healthy customers out', () => {
    const { contact, low } = build()
    expect(contact.map((e) => e.customerId)).toEqual(['c-risk'])
    expect(low.map((e) => e.customerId)).toEqual(['c-low'])
    expect(contact[0]).toMatchObject({
      name: '田中一',
      karuteNumber: '#00017',
      remaining: 8,
      size: 10,
      daysSinceLastVisit: 78,
      hasNextBooking: false,
    })
  })

  it('a manager dismissal silences CONTACT only — the 残り1回 nudge stays', () => {
    const { contact, low } = build({ dismissed: new Set(['c-risk', 'c-low']) })
    expect(contact).toEqual([])
    expect(low.map((e) => e.customerId)).toEqual(['c-low'])
  })

  it('卒業/離客 customers never alert', () => {
    const { contact } = build({
      lifecycles: new Map([
        ['c-risk', { customer_id: 'c-risk', status: 'graduated' as const, referral: false }],
      ]),
    })
    expect(contact).toEqual([])
  })

  it('contact list sorts most-days-absent first', () => {
    const { contact } = build({
      usage: new Map([
        ['c-a', usage(2)],
        ['c-b', usage(3)],
      ]),
      visitById: new Map([
        ['c-a', { lastVisitIso: daysAgo(30), nextAppointmentIso: null }],
        ['c-b', { lastVisitIso: daysAgo(90), nextAppointmentIso: null }],
      ]),
      nameById: new Map([
        ['c-a', 'A'],
        ['c-b', 'B'],
      ]),
    })
    expect(contact.map((e) => e.customerId)).toEqual(['c-b', 'c-a'])
  })

  it('unknown names fall back to "—" instead of breaking the card', () => {
    const { contact } = build({ nameById: new Map() })
    expect(contact[0]?.name).toBe('—')
  })

  it('totals: 回収リスク sums the VISIBLE contact list; 未消化総額 sums every holder', () => {
    const { totals } = build()
    // c-risk 8×9900 + c-fine 5×9900 + c-low 1×9900 = 14×9900
    expect(totals.unconsumedTotal).toBe(14 * 9900)
    expect(totals.holderCount).toBe(3)
    // only c-risk is in the contact list → at-risk = 8×9900
    expect(totals.atRiskValue).toBe(8 * 9900)
  })

  it('totals: a dismissal removes the customer from atRiskValue but NOT from 未消化総額', () => {
    const { totals } = build({ dismissed: new Set(['c-risk']) })
    expect(totals.atRiskValue).toBe(0)
    expect(totals.unconsumedTotal).toBe(14 * 9900)
  })
})
