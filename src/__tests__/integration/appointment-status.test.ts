import { isTerminalStatus } from '@/lib/appointments/status'

describe('isTerminalStatus', () => {
  it('is true for CANCELLED', () => {
    expect(isTerminalStatus('CANCELLED')).toBe(true)
  })

  it('is true for NO_SHOW', () => {
    expect(isTerminalStatus('NO_SHOW')).toBe(true)
  })

  it.each(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', '', 'anything-else'])(
    'is false for %s',
    (status) => {
      expect(isTerminalStatus(status)).toBe(false)
    },
  )
})
