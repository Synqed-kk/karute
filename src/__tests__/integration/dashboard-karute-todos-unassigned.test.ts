/**
 * The dashboard 録音 todo follows THE one recording-target rule
 * (isRecordingTarget): a 担当未定 booking that ended unrecorded is not a
 * 録音 todo, because nobody could have recorded it. cached.ts maps a
 * staff-less core row to `staff_profile_id: null` at runtime (the field's
 * `string` type does not say so), which is what these rows reproduce.
 */
import { pickKaruteTodos } from '@/lib/dashboard/flow'
import type { DashboardTodayAppointment } from '@/lib/dashboard/cached'

const NOW = new Date('2026-09-15T05:00:00Z')

const ended = (over: Partial<DashboardTodayAppointment>): DashboardTodayAppointment => ({
  id: 'a1',
  client_id: 'c1',
  start_time: '2026-09-15T01:00:00Z',
  duration_minutes: 60,
  staff_profile_id: 'p1',
  title: null,
  notes: null,
  karute_record_id: null,
  customers: { name: 'Tanaka' },
  ...over,
})

describe('pickKaruteTodos — 担当未定 is never a 録音 todo', () => {
  it('an ended, unrecorded, staff-less booking produces no todo', () => {
    const rows = [ended({ id: 'nostaff', staff_profile_id: null as unknown as string })]
    expect(pickKaruteTodos(rows, NOW)).toEqual([])
  })

  it('the same booking with a staff is a todo (the rule bites only on 担当未定)', () => {
    const rows = [ended({ id: 'own' }), ended({ id: 'nostaff', staff_profile_id: null as unknown as string })]
    expect(pickKaruteTodos(rows, NOW).map((a) => a.id)).toEqual(['own'])
  })
})
