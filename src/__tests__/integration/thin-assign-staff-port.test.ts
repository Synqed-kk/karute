/**
 * @jest-environment jsdom
 *
 * 担当未定 (PR-B) — the thin port of assignAppointmentStaff: posts the staff to
 * the booking's assign-staff door, and a transport reject comes back as the
 * action's own { error } shape (the sheet re-enables and stays closable).
 */
import { setDataPort } from '@/lib/ports/data-port'

;(crypto as { randomUUID?: () => string }).randomUUID ??= () =>
  '00000000-0000-4000-8000-000000000000'

jest.mock('@/lib/karute/take-store', () => ({}))

import { assignAppointmentStaff } from '../../../thin/ports/actions.vite'

describe('thin actions port — assignAppointmentStaff', () => {
  it("posts { staffProfileId } to the booking's assign-staff door", async () => {
    let sent: { path: string; body: unknown } | null = null
    const apiFetch = jest.fn(async (path: string, init: RequestInit) => {
      sent = { path, body: JSON.parse(init.body as string) }
      return new Response(JSON.stringify({ success: true }))
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    await assignAppointmentStaff('appt 1', 'p2')
    expect(sent).toEqual({
      path: '/api/app/v1/appointments/appt%201/assign-staff',
      body: { staffProfileId: 'p2' },
    })
  })

  it('maps a transport reject to { error }', async () => {
    const apiFetch = jest.fn(async () => {
      throw new TypeError('Load failed')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    await expect(assignAppointmentStaff('a1', 'p2')).resolves.toEqual({ error: 'Load failed' })
  })
})
