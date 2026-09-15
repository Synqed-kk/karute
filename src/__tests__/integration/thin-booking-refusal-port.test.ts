/**
 * ⚖ R1-1 — the phone carries the refusal's own fields.
 *
 * The thin shell swaps `@/actions/*` for this port (thin/vite.config.ts), and
 * the ONE booking dialog picks its Japanese line off `code`/`level`/`kind`.
 * A port that re-typed the body to `{ error }` dropped those three fields, so
 * the phone toasted the developer-facing English string while the computer
 * spoke Japanese — with `tsc` green throughout, because the bundler alias is
 * invisible to the type system.
 *
 * So the contract pinned here is the PASSTHROUGH: a 2xx business refusal
 * arrives at the dialog as the identical object the facade returned.
 */
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('@/lib/karute/take-store', () => ({}))

import { createAppointment } from '../../../thin/ports/actions.vite'

/** The facade's own body for a closed-day refusal (a 200 with { error }). */
const CLOSED_DAY_BODY = {
  error: 'This day is closed — pick another day.',
  code: 'closed_day',
  level: 'store',
  kind: 'weekday',
}

function stubPort(body: unknown, status = 200) {
  const apiFetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
  setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
  return apiFetch
}

const INPUT = {
  staffProfileId: 'staff-1',
  clientId: 'cust-1',
  startTime: '2026-05-11T04:00:00.000Z',
  durationMinutes: 60,
}

describe('thin actions port — createAppointment refusal passthrough', () => {
  it('hands the dialog the SAME object the facade returned (code/level/kind)', async () => {
    stubPort(CLOSED_DAY_BODY)

    const result = await createAppointment(INPUT)

    expect(result).toEqual(CLOSED_DAY_BODY)
  })

  it('carries an hours-window refusal’s code AND its {open, close} params', async () => {
    const body = {
      error: 'Appointment must be within operating hours (09:00-22:00).',
      code: 'outside_hours',
      params: { open: '09:00', close: '22:00' },
    }
    stubPort(body)

    expect(await createAppointment(INPUT)).toEqual(body)
  })

  it('still unwraps a success to { id }', async () => {
    stubPort({ id: 'appt-new' }, 201)

    expect(await createAppointment(INPUT)).toEqual({ id: 'appt-new' })
  })

  it('still maps a transport/auth envelope to a plain { error }', async () => {
    stubPort({ error: { message: 'unauthorized' } }, 401)

    expect(await createAppointment(INPUT)).toEqual({ error: 'unauthorized' })
  })

  it('still names the status when the body says nothing', async () => {
    stubPort(null, 500)

    expect(await createAppointment(INPUT)).toEqual({ error: 'Create failed (500)' })
  })
})
