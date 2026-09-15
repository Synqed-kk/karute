/**
 * @jest-environment jsdom
 *
 * ⚖ TYPE (Liam 2026-09-15 23:4x) — the APP's own type scale rules the text on
 * every new 予約 surface, never the mock's: no `font-bold` (700) on any value or
 * label at 11 px or more. 600 is the app's number weight (the agenda's row
 * values are 13 px / 600) and 500 is its word weight; 700 is what the mock's
 * CSS used, and it reads as shouting next to the rest of the product.
 *
 * The pin is stricter than the ruling on purpose: NO `font-bold` at all in
 * these two components. Everything they draw is 10 px or more and nothing at
 * 10-10.5 px wants 700 either, so "none" is a simpler contract than a per-site
 * size table — and if a sub-11 px case ever genuinely needs it, amending this
 * file is the visible place to argue for it.
 *
 * Source-side AND render-side: the source read catches every state, including
 * the ones a single render does not reach; the render walk catches what the
 * card COMPOSES IN (the day line, the agenda's compact row), which the source
 * read cannot see.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import type { WeekDayRowData } from '@/lib/adapters/reservation'
import type { ReservationView } from '@/lib/adapters/reservation-view'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}))

import { SelectedDayCard } from '@/components/appointments/SelectedDayCard'

const SRC = join(process.cwd(), 'src/components/appointments')
const COMPONENTS = ['SelectedDayCard.tsx', 'MonthPage.tsx', 'DayNumbersLine.tsx']

function totals(): WeekDayRowData {
  return {
    dateNumber: 20,
    monthNumber: 8,
    weekdayLabel: '木',
    isToday: false,
    count: 6,
    bookedMinutes: 300,
    availableMinutes: 480,
    newCustomerCount: 0,
    remindersPending: 0,
    consentPending: 0,
    unconfirmed: 0,
    visibleBookings: [],
    hiddenCount: 0,
    dateIso: '2026-08-20',
    capacityDefensible: false,
    hoursSaved: false,
    closed: false,
    cancelledCount: 1,
    noShowDayCount: 0,
    returningCount: 0,
  }
}

function booking(n: number): ReservationView {
  return {
    id: `appt-${n}`,
    staffId: 'staff-1',
    staffName: 'スタッフ',
    startTimeHm: `${String(9 + n).padStart(2, '0')}:00`,
    durationMin: 60,
    customerName: `テスト${n}`,
    customerInitials: 'テ',
    karuteNumber: null,
    service: '',
    displayStatus: 'booked',
    isCancelled: false,
    isNoShow: false,
    statusReason: null,
    statusSetByName: null,
    statusSetAt: null,
    staffColorKey: 'neutral',
    clientId: `client-${n}`,
    karuteRecordId: null,
    isFirstTimeVisit: false,
    pack: null,
    needsRenewal: false,
    noShowCount: 0,
  } as ReservationView
}

describe('⚖ TYPE — no 700 on a value or a label at 11 px or more', () => {
  it('neither the card, the month page nor the day line spells font-bold', () => {
    for (const file of COMPONENTS) {
      const source = readFileSync(join(SRC, file), 'utf8')
      // `font-bold` as a class, not the word inside a comment or a variant name
      const hits = source.match(/(^|[\s'"`:{])font-bold([\s'"`}]|$)/gm) ?? []
      expect({ file, hits }).toEqual({ file, hits: [] })
    }
  })

  it('and nothing the card RENDERS carries it either — the line and the rows included', () => {
    const { container } = render(
      <SelectedDayCard
        dateIso="2026-08-20"
        rows={[1, 2, 3, 4, 5, 6].map(booking)}
        dayTotals={totals()}
        soloMode={false}
        locale="ja"
        onOpenDay={jest.fn()}
      />,
    )
    const bold = Array.from(container.querySelectorAll('*')).filter((el) =>
      el.className.toString().split(/\s+/).includes('font-bold'),
    )
    expect(bold.map((el) => el.className.toString())).toEqual([])
  })
})
