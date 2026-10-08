/** @jest-environment jsdom */
import { render } from '@testing-library/react'
import { WeekRows } from '@/components/appointments/WeekRows'
import { appointmentsToWeekData, capacityRowFields } from '@/lib/adapters/reservation'
import { capacityForDay } from '@/lib/capacity/capacity'
import { DATE, DAY, input, minute, hoursFacts } from './__fixtures__/kadou-fixture'
import { WeekDayCardDataDTO } from '@/lib/app-api/appointments-screen-dto'

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key === 'unset' ? '未設定' : key }))

test.each(['none', 'nobody', 'unavailable'] as const)('T20: old-bundle %s rendering is neutral without a percentage or 未設定', state => {
  const off = { staffId: 's1', storeId: 'store', date: DATE, startMs: minute(600), endMs: minute(1140), breaks: [], blocks: [{ startMs: minute(600), endMs: minute(1140) }] }
  const fact = capacityForDay({ ...input([]), shift: { storeId: 'store', date: DATE, rows: state === 'nobody' ? [off] : [], roster: [], readComplete: state !== 'unavailable' } })
  expect(fact.shiftState).toBe(state)
  expect(fact.reason).toBe('roster-unknown')
  const row = appointmentsToWeekData([], new Date(DAY), new Date(DAY), 600, new Date(DAY), 'ja', undefined, undefined, hoursFacts, false, { rosterHeadcount: 5 })[0]
  const oldBundleRow = WeekDayCardDataDTO.omit({ shiftState: true, onShiftNoBooking: true, unassignedOverflow: true }).parse({ ...row, ...capacityRowFields(fact), capacityDefensible: false })
  expect(oldBundleRow).not.toHaveProperty('shiftState')
  const { container } = render(<WeekRows rows={[oldBundleRow]} weekStartIso={DATE} selectedDateIso={DATE} soloMode={false} typeSlot="new" locale="ja" onPickDay={() => {}} />)
  expect(container.textContent).not.toContain('%')
  expect(container.textContent).not.toContain('未設定')
})
