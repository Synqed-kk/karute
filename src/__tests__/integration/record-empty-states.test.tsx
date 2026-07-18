/**
 * @jest-environment jsdom
 *
 * Record-page empty states — a day with no bookings must not look broken.
 * No booking selected → the pre-session brief collapses to ONE explainer
 * line (no 対応予定 placeholder wall), the record button shows neutral copy
 * (never 「—様のセッションを録音します」), and the booking picker says
 * "no bookings today" instead of claiming the picker is unimplemented.
 * next-intl mocked key-echo style (matches the suite's convention).
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${key}:${JSON.stringify(vals)}` : key,
}))

import {
  PreSessionBriefCard,
  type PreSessionBrief,
} from '@/components/karute/redesign/record/PreSessionBriefCard'
import { RecordButtonCard } from '@/components/karute/redesign/record/RecordButtonCard'
import { SelectBookingSheet } from '@/components/karute/redesign/record/SelectBookingSheet'

describe('PreSessionBriefCard with no recording target', () => {
  it('renders the single explainer line, not the scaffold wall', () => {
    render(<PreSessionBriefCard brief={null} />)
    expect(screen.getByText('noTarget')).toBeTruthy()
    // The old scaffold rendered every section as a 対応予定 hint.
    expect(screen.queryByText(/aiHint/)).toBeNull()
    expect(screen.queryByText('hooks')).toBeNull()
    expect(screen.queryByText('concerns')).toBeNull()
  })

  it('still renders real sections when a brief exists', () => {
    const brief: PreSessionBrief = {
      lastVisitDate: '2026年7月1日',
      lastVisitAgo: '17日前',
      hooks: [{ title: '犬の散歩', body: null }],
      concerns: ['肩こり'],
      lastProduct: null,
      recommendedFocus: null,
    }
    render(<PreSessionBriefCard brief={brief} />)
    expect(screen.queryByText('noTarget')).toBeNull()
    expect(screen.getByText('犬の散歩')).toBeTruthy()
    expect(screen.getByText('肩こり')).toBeTruthy()
  })
})

describe('RecordButtonCard subtitle', () => {
  it('uses neutral copy when no customer is bound', () => {
    render(
      <RecordButtonCard
        customerName={null}
        isRecording={false}
        elapsedSeconds={0}
        onStart={() => {}}
        onStop={() => {}}
      />,
    )
    expect(screen.getByText('startSubNoTarget')).toBeTruthy()
  })

  it('names the customer when one is bound', () => {
    render(
      <RecordButtonCard
        customerName="田中"
        isRecording={false}
        elapsedSeconds={0}
        onStart={() => {}}
        onStop={() => {}}
      />,
    )
    expect(screen.getByText(/startSub:.*田中/)).toBeTruthy()
  })
})

describe('SelectBookingSheet with zero bookings', () => {
  it('says no-bookings-today instead of coming-soon', () => {
    render(
      <SelectBookingSheet
        open
        onOpenChange={() => {}}
        bookings={[]}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText('pickerEmpty')).toBeTruthy()
    expect(screen.queryByText(/pickerScaffold/)).toBeNull()
  })
})
