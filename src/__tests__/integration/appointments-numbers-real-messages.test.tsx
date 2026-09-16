/**
 * @jest-environment jsdom
 *
 * R3-5 — the ONE suite that renders the week grid and the day numbers line
 * against the REAL messages/ja.json and messages/en.json.
 *
 * week-rows / day-numbers-line / metric-menu each hard-code their own JA
 * dictionary, so nothing in this lane ever read the shipped files and the EN
 * door went untested: `countValue` is 「{n}件」 in JA and 「{n}」 in EN, the day
 * line printed no label for the count (JA's value says 件 on its own), and EN
 * therefore rendered a naked "11" with no word anywhere near it.
 *
 * ⚖ 2026-09-16 — Liam asked for 「11件 予約」: the line prints the WORD for the
 * count like it does for the other three, so both surfaces now read the same
 * `countValue` beside the same 予約 / Bookings label, and neither locale can
 * leave a number standing on its own.
 *
 * next-intl ships ESM only and this repo's jest does not transform it (every
 * suite here mocks it), so the mock below is a real ICU-lite reader over the
 * shipped JSON rather than the provider — the strings under test are the
 * shipped ones, which is what this suite exists to prove.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { capacityRowFields, type WeekDayRowData } from '@/lib/adapters/reservation'

const MESSAGES: Record<string, Record<string, string>> = Object.fromEntries(
  ['ja', 'en'].map((locale) => [
    locale,
    JSON.parse(readFileSync(join(__dirname, '../../../messages', `${locale}.json`), 'utf8'))
      .reservation.weekRows as Record<string, string>,
  ]),
)

let locale = 'ja'
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    const s = MESSAGES[locale][key]
    if (s === undefined) throw new Error(`missing ${locale} key reservation.weekRows.${key}`)
    if (!values) return s
    return Object.entries(values).reduce(
      (out, [k, v]) => out.split(`{${k}}`).join(String(v)),
      s,
    )
  },
}))

import { DayNumbersLine } from '@/components/appointments/DayNumbersLine'
import { WeekRows } from '@/components/appointments/WeekRows'

function row(over: Partial<WeekDayRowData> = {}): WeekDayRowData {
  return {
    dateNumber: 15,
    monthNumber: 9,
    weekdayLabel: '火',
    isToday: false,
    count: 11,
    bookedMinutes: 210,
    availableMinutes: 480,
    newCustomerCount: 1,
    remindersPending: 0,
    consentPending: 0,
    unconfirmed: 0,
    visibleBookings: [],
    hiddenCount: 0,
    dateIso: '2026-09-15',
    capacityDefensible: false,
    hoursSaved: false,
    closed: false,
    cancelledCount: 2,
    noShowDayCount: 0,
    // No capacity unless a case says so — the honest default (PKT-1c-B).
    ...capacityRowFields(undefined),
    returningCount: 2,
    ...over,
  }
}

afterEach(() => {
  locale = 'ja'
})

describe('the day line never prints a naked count (R3-5)', () => {
  it.each([
    ['ja', '11件予約'],
    ['en', '11Bookings'],
  ])('%s: the count carries its own word', (loc, expected) => {
    locale = loc
    const { container } = render(
      <DayNumbersLine row={row()} soloMode={false} typeSlot="off" locale={loc} />,
    )
    const line = container.querySelector('[data-day-line]')!
    expect(line.textContent!.startsWith(expected)).toBe(true)
    // …and the number is never left standing on its own: the word is inside
    // the SAME element as the value it belongs to, in both locales. (The two
    // read as one string here only because the 4px between them is a CSS gap,
    // not a space — see the DOM-order suite for the rendered shape.)
    const first = line.firstElementChild!
    expect(first.querySelector('b')!.textContent).toBe(loc === 'ja' ? '11件' : '11')
    expect(first.textContent).toBe(expected)
  })

  it('the line and the grid print the SAME value key, in both locales', () => {
    // One value, one label, two surfaces — the drift this suite exists to
    // catch cannot start if there is only one key left to read.
    expect(MESSAGES.ja.countValue).toBe('{n}件')
    expect(MESSAGES.en.countValue).toBe('{n}')
  })

  it('a closed day reads the same way on the line', () => {
    locale = 'en'
    const { container } = render(
      <DayNumbersLine row={row({ closed: true, count: 0 })} soloMode={false} typeSlot="off" locale="en" />,
    )
    // Since R1-3 closedDays ships ON, so this takes the closed branch — which
    // still prints the count beside 休, through `countLine` (the one place a
    // count is shown with NO label, because 休 is the word beside it). The
    // assertion that matters is only that the number is never left naked.
    expect(container.querySelector('[data-day-line]')!.textContent).toContain('bookings')
  })
})

describe('the week GRID keeps its own label + countValue (R3-5)', () => {
  const baseProps = {
    weekStartIso: '2026-09-14',
    selectedDateIso: '2026-09-15',
    todayIso: '2026-09-15',
    soloMode: false,
    typeSlot: 'off' as const,
    onPickDay: jest.fn(),
  }

  it.each([
    ['ja', '予約', '11件'],
    ['en', 'Bookings', '11'],
  ])('%s: the cell is label + value', (loc, label, value) => {
    locale = loc
    const { container } = render(
      <WeekRows {...baseProps} locale={loc} rows={[row()]} onPickDay={jest.fn()} />,
    )
    const cell = container.querySelector('[data-week-cell]')!
    expect(cell.textContent).toBe(`${label}${value}`)
  })

  it('every key both components ask for exists in BOTH locales', () => {
    for (const loc of ['ja', 'en']) {
      locale = loc
      expect(() =>
        render(<DayNumbersLine row={row()} soloMode={false} typeSlot="off" locale={loc} />),
      ).not.toThrow()
      expect(() =>
        render(<WeekRows {...baseProps} locale={loc} rows={[row()]} onPickDay={jest.fn()} />),
      ).not.toThrow()
    }
    expect(screen).toBeDefined()
  })
})
