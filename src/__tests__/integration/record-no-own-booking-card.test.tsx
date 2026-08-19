/** @jest-environment jsdom */
/**
 * 録音対象 card, no-own-booking state (mock A2, 8/19). buildRecordScreen now
 * returns a NULL target when the signed-in staff has no booking of their own
 * — this is the screen that replaces the auto-picked colleague. The card must
 * offer the two explicit ways forward and must NOT surface the day picker,
 * which lists the WHOLE salon's bookings (that is how a colleague's customer
 * would reappear on this screen through the back door).
 *
 * Rendered against the REAL ja.json — a call-site key typo throws here.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.'))
        cur = (cur as Record<string, unknown> | undefined)?.[part]
      if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return cur.replace(/\{(\w+)\}/g, (_m, v: string) => String(vars?.[v] ?? `{${v}}`))
    },
  }
})

import {
  RecordingTargetCard,
  type RecordTargetBooking,
} from '@/components/karute/redesign/record/RecordingTargetCard'

const COLLEAGUE_BOOKING: RecordTargetBooking = {
  id: 'a-theirs',
  start: '10:30',
  end: '12:00',
  customer: '佐藤 美咲',
  initials: '佐藤',
  karute: 'K-0142',
  service: 'カット',
  staff: '佐藤',
  staffId: 's-other',
  staffColorKey: null,
  statusKey: 'booked',
  statusLabel: '予約済',
}

describe('録音対象 card — no own booking today', () => {
  it('offers the two explicit actions and hides the salon-wide picker', () => {
    const onChooseCustomer = jest.fn()
    const onRecordWithoutCustomer = jest.fn()
    render(
      <RecordingTargetCard
        appointment={null}
        nearbyBookings={[COLLEAGUE_BOOKING]}
        onChooseCustomer={onChooseCustomer}
        onRecordWithoutCustomer={onRecordWithoutCustomer}
      />,
    )

    expect(screen.getByText('本日の担当予約はありません')).toBeInTheDocument()
    screen.getByRole('button', { name: /お客様を選んで録音/ }).click()
    screen.getByRole('button', { name: /選択せずに録音する/ }).click()
    expect(onChooseCustomer).toHaveBeenCalledTimes(1)
    expect(onRecordWithoutCustomer).toHaveBeenCalledTimes(1)

    // The colleague's booking must not be reachable from this state.
    expect(screen.queryByText('別の予約を選択')).not.toBeInTheDocument()
    expect(screen.queryByText('佐藤 美咲')).not.toBeInTheDocument()
  })

  // A-1 (blind round 8/19): the other null-target state — an anonymous
  // 選択せずに録音する take in flight. It used to fall back to the legacy
  // scaffold, whose 別の予約を選択 sheet lists the WHOLE salon's day: one tap
  // from the new card's own secondary action and the colleague's booking was
  // back on screen. Unbound placeholder now, picker in NO null state.
  it('renders the unbound placeholder with no picker when a take is in flight', () => {
    render(<RecordingTargetCard appointment={null} nearbyBookings={[COLLEAGUE_BOOKING]} />)
    expect(screen.getByText('予約が選択されていません')).toBeInTheDocument()
    expect(screen.getByText(/保存するときにお客様を選べます/)).toBeInTheDocument()
    expect(screen.queryByText('別の予約を選択')).not.toBeInTheDocument()
    expect(screen.queryByText('佐藤 美咲')).not.toBeInTheDocument()
    expect(screen.queryByText('本日の担当予約はありません')).not.toBeInTheDocument()
  })
})
