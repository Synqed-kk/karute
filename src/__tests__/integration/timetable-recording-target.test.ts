/**
 * Coverage for the timetable store's recording target (src/stores/timetable-store.ts).
 * setRecordingAppointmentId now carries the appointment's customer id so the
 * dashboard → record → save flow can pre-fill + attribute the karute without a
 * manual re-pick (record-from-dashboard customer-attribution fix). Verifies the
 * appointment + customer set together, and both clear when the appointment is
 * cleared or re-set without a customer.
 */
import { useTimetableStore } from '@/stores/timetable-store'

describe('timetable store — recording target', () => {
  beforeEach(() => {
    useTimetableStore.getState().setRecordingAppointmentId(null)
  })

  it('sets the appointment id and customer id together', () => {
    useTimetableStore.getState().setRecordingAppointmentId('appt-1', 'cust-1')
    const s = useTimetableStore.getState()
    expect(s.recordingAppointmentId).toBe('appt-1')
    expect(s.recordingCustomerId).toBe('cust-1')
  })

  it('clears both when the appointment is cleared (null)', () => {
    useTimetableStore.getState().setRecordingAppointmentId('appt-1', 'cust-1')
    useTimetableStore.getState().setRecordingAppointmentId(null)
    const s = useTimetableStore.getState()
    expect(s.recordingAppointmentId).toBeNull()
    expect(s.recordingCustomerId).toBeNull()
  })

  it('clears a stale customer when a new appointment is set without one', () => {
    useTimetableStore.getState().setRecordingAppointmentId('appt-1', 'cust-1')
    useTimetableStore.getState().setRecordingAppointmentId('appt-2')
    const s = useTimetableStore.getState()
    expect(s.recordingAppointmentId).toBe('appt-2')
    expect(s.recordingCustomerId).toBeNull()
  })
})

export {}
