// ONE clock anchor per server render (Greptile P1 on #724).
//
// The fixture calendar is RELATIVE (⚖ L-6): `appointments()` re-derives every
// date from the clock on each call. So a render that reads the clock more than
// once — listAppointments, then listVisits, then the screen's own `new Date()`
// — could straddle JST midnight and mix TWO fixture days in one page: the same
// booking with two dates, or today's bookings filtered against tomorrow's now.
//
// React cache() is what pins one value per request in a server render, but it
// has no request scope in jest — outside a render it is a verified pass-through
// — so a real per-scope memo stands in for it here and this test body IS the
// one render. That keeps the assertion honest: it proves data.ts routes every
// fixture-day derivation through a SINGLE anchor call, which is the fix.

jest.mock('react', () => ({
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    let resolved = false
    let value: R
    return (...args: A): R => {
      if (!resolved) {
        resolved = true
        value = fn(...args)
      }
      return value
    }
  },
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jstMidnight } from '@/business/lib/clock'
import { listAppointments, listVisits, renderNow } from '@/business/lib/data'
import { STORE_A } from '@/business/lib/fixtures'

const RealDate = Date
// 23:59:59 JST on 8/19 → the very next read is 00:00:01 JST on 8/20.
const BEFORE = new RealDate('2026-08-19T14:59:59.000Z')
const AFTER = new RealDate('2026-08-19T15:00:01.000Z')

/** A clock that crosses JST midnight between the first read and the second —
 *  the render the finding describes. Only the zero-argument construction is
 *  faked; `new Date(iso)` / `new Date(ms)` stay real (clock.ts needs them). */
function installFlippingClock(): () => void {
  let reads = 0
  const stub = function (this: unknown, ...args: unknown[]) {
    if (args.length === 0) return new RealDate(reads++ === 0 ? BEFORE : AFTER)
    return new RealDate(...(args as [string]))
  } as unknown as DateConstructor
  // No prototype wiring needed: the stub RETURNS a real Date, so `new Date()`
  // still yields a genuine instance with all its methods.
  globalThis.Date = stub
  return () => {
    globalThis.Date = RealDate
  }
}

describe('one clock anchor per render (#724)', () => {
  it('the stand-in clock really does flip the JST day between two reads', () => {
    // Guards against a vacuous green: if the stub stopped flipping, the test
    // below would pass no matter how many times the door read the clock.
    const restore = installFlippingClock()
    try {
      expect(jstMidnight(new Date())).not.toBe(jstMidnight(new Date()))
    } finally {
      restore()
    }
  })

  it('appointments, visits and the screen anchor all land on ONE fixture day', async () => {
    const restore = installFlippingClock()
    try {
      // The exact composition the customers page makes, in its order.
      const appointments = await listAppointments(STORE_A)
      const visits = await listVisits(STORE_A)
      const anchor = renderNow()

      // apt-01 is a completed booking, so it is in BOTH reads. One row, one
      // date: this is the "予約 says one day, 来店履歴 says another" defect.
      const inAppointments = appointments.find((a) => a.id === 'apt-01')
      const inVisits = visits.find((a) => a.id === 'apt-01')
      expect(inAppointments).toBeDefined()
      expect(inVisits).toBeDefined()
      expect(inVisits!.starts_at).toBe(inAppointments!.starts_at)

      // apt-12 is the fixtures' day-0 booking, so its JST day IS "today" for
      // this render. The page's 次回予約 filter compares against `renderNow()`;
      // if that came off a later clock read, today's bookings would be judged
      // against another day's midnight.
      const today = appointments.find((a) => a.id === 'apt-12')
      expect(today).toBeDefined()
      expect(jstMidnight(anchor)).toBe(jstMidnight(new RealDate(today!.starts_at)))
    } finally {
      restore()
    }
  })

  it('no screen reads the clock itself — the anchor is the only source', () => {
    // Structural, because the page is a server component: a re-introduced
    // `new Date()` in it is a second clock read no runtime test in node would
    // see. Same readFileSync idiom as the import-inventory pin, comment lines
    // stripped first so prose about the fix can't stand in for the fix.
    const code = (file: string) =>
      readFileSync(join(process.cwd(), file), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n')

    const page = code('src/app/[locale]/(business)/business/customers/page.tsx')
    expect(page).toContain('renderNow().toISOString()')
    expect(page.match(/new Date\(\s*\)/g)).toBeNull()

    // 今日の運営 has the same exposure and more of it: todayKey, the read
    // window, 表示日, the month calendar and the ルール stamp all hang off one
    // `now`, so a bare clock read there shifts the whole board a day.
    const today = code('src/app/[locale]/(business)/business/today/page.tsx')
    expect(today).toContain('const now = renderNow()')
    expect(today.match(/new Date\(\s*\)/g)).toBeNull()

    // 予約一覧 has the widest exposure of the three screens: the READ WINDOW
    // itself (`from`/`to`), 今日 bucketing, 表示日 and the 明日 label all hang
    // off one `now`, so a bare clock read here can fetch one day's window and
    // then label it with another's. (Greptile P1 on #727 — this page's commits
    // predate the #724 fix, so it carried the same disease.)
    const reservations = code('src/app/[locale]/(business)/business/reservations/page.tsx')
    expect(reservations).toContain('const now = renderNow()')
    expect(reservations.match(/new Date\(\s*\)/g)).toBeNull()

    // …and in the door itself the one bare clock read sits inside cache(),
    // with no call to appointments() left taking its own default clock.
    const data = code('src/business/lib/data.ts')
    expect(data.match(/new Date\(\s*\)/g)).toHaveLength(1)
    expect(data).toContain('cache((): Date => new Date())')
    expect(data.match(/appointments\(\s*\)/g)).toBeNull()

    // THE BLIND SPOT the scans above cannot see: clock.ts DEFAULTS its `now`
    // parameter to `new Date()` (jstMidnight, jstSlot, jstSlotEnd — verified to
    // be the complete set; jstDayKey and jstMinuteOfDay take a required
    // argument), so a guarded file can take a second clock read with no
    // `new Date()` of its own anywhere in it. Every call to one of them must
    // hand over the anchor.
    //
    // "Hands over the anchor" is `renderNow()` inline OR the anchor const being
    // passed as the last argument — the second is the idiom every guarded file
    // actually uses (`const now = renderNow()`, then `jstSlot(…, now)`), and
    // requiring the literal call on every line would have failed correct code.
    // The `const now = renderNow()` assertion above is what makes passing `now`
    // mean the anchor and not some other local.
    //
    // ponytail: line-level, not a parse. It catches the omitted argument, which
    // is the whole defect; it would not catch a line that both calls a helper
    // WITHOUT the anchor and mentions `now)` for some other reason. Reach for a
    // real parse if that ever stops being far-fetched.
    for (const [file, src] of [
      ['customers/page.tsx', page],
      ['today/page.tsx', today],
      ['reservations/page.tsx', reservations],
      ['data.ts', data],
    ] as const) {
      for (const line of src.split('\n').filter((l) => /\b(jstMidnight|jstSlot|jstSlotEnd)\(/.test(l))) {
        expect(`${file}: ${line.trim()}`).toMatch(/renderNow\(\)|\bnow\s*\)/)
      }
    }
  })
})
