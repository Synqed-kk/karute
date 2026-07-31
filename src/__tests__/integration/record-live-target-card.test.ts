/**
 * 録音対象 card while a recording is LIVE — field bug 7/29 (IMG_8557):
 * 27 minutes into a real session the card showed 担当:— (and service —,
 * empty time range, pill stuck on 予約済) while the blue banner correctly
 * said the record saves as the signed-in user. Liam's ruling (7/29): the
 * card must agree with the banner — while recording, 担当 shows the
 * SAVE-AS identity (the recorder); blank is the bug.
 *
 * Repro fixture mirrors the field case: booking 担当 = 原田かなみ,
 * recorded under the Liam owner account, 16:00–17:00 VIP施術.
 */
// Pin the worker's local TZ away from JST so dropping the explicit
// timeZone: 'Asia/Tokyo' in formatTimeRange fails HERE, not only on
// UTC CI runners (blind-round finding: the mutant survived on a JST
// dev machine).
process.env.TZ = 'UTC'

import {
  deriveInitials,
  liveTargetCardAppointment,
  formatTimeRange,
} from '@/components/karute/redesign/record/live-target-appointment'
import type { RecordingTarget } from '@/lib/global-recorder'

const fieldCaseTarget: RecordingTarget = {
  customerId: 'cust-liem',
  customerName: 'リエム 代表',
  karuteNumber: '#00019',
  appointmentId: 'appt-1600',
  // Display snapshot captured at recording start (bind time).
  service: 'VIP施術',
  timeRange: '16:00–17:00',
  statusKey: 'in-session',
  isNew: false,
}

describe('録音対象 card while recording (liveTargetCardAppointment)', () => {
  it('担当 = the save-as recorder, never a blank dash (field bug 7/29)', () => {
    const card = liveTargetCardAppointment(fieldCaseTarget, 'Liam')
    expect(card.staffName).toBe('Liam')
  })

  it('keeps the booking display snapshot instead of degrading to placeholders', () => {
    const card = liveTargetCardAppointment(fieldCaseTarget, 'Liam')
    expect(card.service).toBe('VIP施術')
    expect(card.timeRange).toBe('16:00–17:00')
    expect(card.statusKey).toBe('in-session')
    // Bound-customer identity untouched (the part that was already right).
    expect(card.customerName).toBe('リエム 代表')
    expect(card.karuteNumber).toBe('#00019')
    expect(card.id).toBe('appt-1600')
  })

  it('falls back to placeholders on a legacy target without the snapshot (old persisted take)', () => {
    const legacy: RecordingTarget = {
      customerId: 'cust-1',
      customerName: '田中 花子',
      karuteNumber: null,
      appointmentId: null,
    }
    const card = liveTargetCardAppointment(legacy, '原田 かなみ')
    expect(card.staffName).toBe('原田 かなみ')
    expect(card.service).toBe('—')
    expect(card.timeRange).toBe('')
    expect(card.statusKey).toBe('booked')
    expect(card.isNew).toBe(false)
    expect(card.id).toBe('')
  })

  it('shows the dash only when the signed-in user has no staff display name', () => {
    const card = liveTargetCardAppointment(fieldCaseTarget, null)
    expect(card.staffName).toBe('—')
  })

  it('passes a first-visit snapshot through to the 新規 pill', () => {
    // Blind-round finding: no fixture exercised isNew=true, so hardcoding
    // `isNew: false` shipped green while silently dropping the 新規 pill.
    const card = liveTargetCardAppointment({ ...fieldCaseTarget, isNew: true }, 'Liam')
    expect(card.isNew).toBe(true)
  })
})

describe('deriveInitials', () => {
  it('derives avatar initials for single and spaced names', () => {
    expect(deriveInitials('田中')).toBe('田中')
    expect(deriveInitials('リエム 代表')).toBe('リ代')
    expect(deriveInitials('anna maria smith')).toBe('AS')
  })
})

describe('formatTimeRange', () => {
  it('renders the JST range from start + duration', () => {
    // 07:00 UTC = 16:00 JST — the field case's booking window.
    expect(formatTimeRange('2026-07-28T07:00:00.000Z', 60)).toBe('16:00–17:00')
  })
})
