/**
 * @jest-environment jsdom
 *
 * Appointment entries of the thin actions port (design-parity P-B 2/2).
 * Pins the TRANSPORT contract: an offline/DNS reject from the DataPort must
 * come back as the actions' own { error } shape — NewBookingDialog and
 * CancelBookingSheet await these WITHOUT a try/catch, so a rejection would
 * strand the save button / freeze the hold-pill with no toast.
 */
import { setDataPort } from '@/lib/ports/data-port'

// jsdom 20 has no crypto.randomUUID (WKWebView ≥15.4 does — the shell's
// floor); the port's Idempotency-Key mint needs it.
;(crypto as { randomUUID?: () => string }).randomUUID ??= () =>
  '00000000-0000-4000-8000-000000000000'

jest.mock('@/lib/karute/take-store', () => ({}))

import {
  cancelAppointment,
  createAppointment,
  getBurnablePackSummary,
  markNoShowAppointment,
  restoreAppointment,
} from '../../../thin/ports/actions.vite'

describe('thin actions port — appointments transport contract', () => {
  beforeEach(() => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed') // WebKit's offline fetch reject
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  })

  it('createAppointment maps a transport reject to { error }', async () => {
    const result = await createAppointment({
      staffProfileId: 's1',
      clientId: 'c1',
      startTime: new Date().toISOString(),
      durationMinutes: 60,
    })
    expect(result).toEqual({ error: 'Load failed' })
  })

  it('cancel / no-show / restore map transport rejects to { error }', async () => {
    await expect(cancelAppointment('a1', {})).resolves.toEqual({ error: 'Load failed' })
    await expect(markNoShowAppointment('a1', { burnPack: false })).resolves.toEqual({
      error: 'Load failed',
    })
    await expect(restoreAppointment('a1')).resolves.toEqual({ error: 'Load failed' })
  })

  it('getBurnablePackSummary keeps its catch→null contract', async () => {
    await expect(getBurnablePackSummary('c1')).resolves.toBeNull()
  })
})
