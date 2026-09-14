/**
 * The weekday a 予約 day resolves to is a JST weekday.
 *
 * getWeekdayKey read `date.getDay()`, i.e. the RUNTIME calendar — UTC on
 * Vercel. A JST day begins at 15:00 UTC the day before, so every evening of
 * the week resolved to the PREVIOUS weekday and picked the wrong day's opening
 * hours. Pinned to TZ=UTC to mirror the deploy, which is where the bug lives.
 */
process.env.TZ = 'UTC'

import { getWeekdayKey, savedWeekdays } from '@/lib/operating-hours'

describe('getWeekdayKey — JST, not the runtime calendar (mutant m5)', () => {
  it('JST midnight on Tue 2026-09-15 is tue', () => {
    expect(getWeekdayKey(new Date('2026-09-15T00:00:00+09:00'))).toBe('tue')
  })

  it('a UTC instant on the Monday EVENING that is already Tuesday in JST is tue', () => {
    // 2026-09-14 15:30 UTC = 2026-09-15 00:30 JST. getDay() says 'mon'.
    expect(getWeekdayKey(new Date('2026-09-14T15:30:00Z'))).toBe('tue')
  })

  it('a UTC instant still inside the JST Monday is mon', () => {
    // 2026-09-14 14:59 UTC = 2026-09-14 23:59 JST.
    expect(getWeekdayKey(new Date('2026-09-14T14:59:00Z'))).toBe('mon')
  })

  it('every day of a JST week maps in order', () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      getWeekdayKey(new Date(`2026-09-${14 + i}T00:00:00+09:00`)),
    )
    expect(days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
  })
})

describe('savedWeekdays — the days a human really set', () => {
  it('keeps a valid day and drops an open-after-close one', () => {
    expect(
      savedWeekdays({
        tue: { openMinute: 600, closeMinute: 1200 },
        wed: { openMinute: 900, closeMinute: 300 },
      }),
    ).toEqual(['tue'])
  })

  it('an absent, null or non-object day is not saved', () => {
    expect(savedWeekdays({ mon: null, tue: 'open!', wed: undefined })).toEqual([])
    expect(savedWeekdays(null)).toEqual([])
    expect(savedWeekdays(undefined)).toEqual([])
    expect(savedWeekdays('nonsense')).toEqual([])
  })

  it('reports the days in week order', () => {
    const raw = {
      sun: { openMinute: 600, closeMinute: 1080 },
      mon: { openMinute: 600, closeMinute: 1080 },
      fri: { openMinute: 600, closeMinute: 1080 },
    }
    expect(savedWeekdays(raw)).toEqual(['mon', 'fri', 'sun'])
  })

  it('agrees with normalizeOperatingHours about which days were real', () => {
    // The shared-validation guard: a day savedWeekdays reports must be the same
    // day normalizeOperatingHours kept rather than defaulted.
    const raw = { thu: { openMinute: 540, closeMinute: 1020 } }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { normalizeOperatingHours } = require('@/lib/operating-hours')
    expect(savedWeekdays(raw)).toEqual(['thu'])
    expect(normalizeOperatingHours(raw).thu).toEqual({ openMinute: 540, closeMinute: 1020 })
  })
})
