import { DEFAULT_BREAK_MINUTES, resolveBreakMinutes } from '@/lib/capacity/break-minutes'

test('resolveBreakMinutes: a finite integer ≥ 0 wins; anything else is the default 60', () => {
  expect(DEFAULT_BREAK_MINUTES).toBe(60)
  expect(resolveBreakMinutes({ break_minutes: 45 })).toBe(45)
  expect(resolveBreakMinutes({ break_minutes: 0 })).toBe(0)
  expect(resolveBreakMinutes({ break_minutes: undefined })).toBe(60)
  expect(resolveBreakMinutes({})).toBe(60)
  expect(resolveBreakMinutes(null)).toBe(60)
  expect(resolveBreakMinutes({ break_minutes: 'abc' })).toBe(60)
  expect(resolveBreakMinutes({ break_minutes: '45' })).toBe(60)
  expect(resolveBreakMinutes({ break_minutes: -10 })).toBe(60)
  expect(resolveBreakMinutes({ break_minutes: Number.NaN })).toBe(60)
  expect(resolveBreakMinutes({ break_minutes: 12.5 })).toBe(60)
  expect(resolveBreakMinutes({ break_minutes: Number.POSITIVE_INFINITY })).toBe(60)
})
