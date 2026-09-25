// 予約の色分け — THE FOUR CATEGORY COLOURS HAVE ONE HOME.
//
// `bookingColorsFor` (today-board.ts) turns the business's org-settings
// `booking_colors` value into one store's four colours; page.tsx calls it once
// per store and TodayScreen only indexes the result. Nothing writes the key yet
// (the 設定 save is PR-2), so on every store today the answer is the defaults.
//
// WHAT THIS FILE PROVES:
//   (a) the defaults ARE today.css's four `--cat` hexes — read from the file,
//       not a copy — so a board with nothing saved paints exactly what it
//       painted before (the CSS lines stay as the fallback).
//   (b) the resolver's closed shape: per key a `#rrggbb` (any case, returned
//       lowercase) or that key's default; anything else falls back per key.
//   (c) it never throws, whatever the stored value is.
//   (d) `bookingColorHex` — the ONE lookup the board paints with (TodayScreen's
//       `catVar` only wraps it in `--cat`): the store's own entry, else `''`'s,
//       else nothing, so today.css's hex paints.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOOKING_COLOR_DEFAULTS, bookingColorHex, bookingColorsFor, type BookingColors } from '@/business/lib/today-board'

const SAVED: BookingColors = { new: '#112233', repeat: '#445566', ticket: '#778899', vip: '#aabbcc' }
const KEYS = ['new', 'repeat', 'ticket', 'vip']

describe('(a) the defaults are today.css\'s four --cat hexes', () => {
  it('parses exactly four category rules and they equal BOOKING_COLOR_DEFAULTS', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/today/today.css'), 'utf8')
    // The attribute value is QUOTED in the file (`data-cat="new"`); an unquoted form matches nothing.
    const found: Record<string, string> = {}
    for (const m of css.matchAll(/\.event\[data-cat="(new|repeat|ticket|vip)"\][^{]*\{[^}]*--cat:\s*(#[0-9a-f]{6})/g)) found[m[1]] = m[2]
    expect(Object.keys(found).sort()).toEqual([...KEYS].sort())
    expect(found).toEqual(BOOKING_COLOR_DEFAULTS)
  })
})

describe('(b) bookingColorsFor — per key a #rrggbb or the default', () => {
  const S = 'store-1'
  it.each([
    ['raw null', S, null],
    ['raw undefined', S, undefined],
    ['raw a string', S, '#112233'],
    ['raw an array', S, []],
    ['unknown store', 'store-2', { [S]: SAVED }],
    ['storeId null with a saved map', null, { [S]: SAVED }],
  ])('%s → the defaults', (_name, id, raw) => {
    expect(bookingColorsFor(id as string | null, raw)).toEqual(BOOKING_COLOR_DEFAULTS)
  })

  it('a saved store with all four valid → its four, lowercase', () => {
    const upper = { new: '#AABBCC', repeat: '#445566', ticket: '#778899', vip: '#A1B2C3' }
    expect(bookingColorsFor(S, { [S]: SAVED })).toEqual(SAVED)
    expect(bookingColorsFor(S, { [S]: upper })).toEqual({ new: '#aabbcc', repeat: '#445566', ticket: '#778899', vip: '#a1b2c3' })
  })

  it('one key uppercase → lowercase; the others kept', () => {
    expect(bookingColorsFor(S, { [S]: { ...SAVED, new: '#3D7AB8' } })).toEqual({ ...SAVED, new: '#3d7ab8' })
  })

  it.each([
    ['#abc (short form)', '#abc'],
    ['a colour name', 'red'],
    ['rgb()', 'rgb(1, 2, 3)'],
    ['7+ hex digits', '#1122334'],
    ['no hash', '112233'],
    ['a number', 0x112233],
  ])('one key %s → that key\'s default, the others kept', (_name, bad) => {
    expect(bookingColorsFor(S, { [S]: { ...SAVED, repeat: bad } })).toEqual({ ...SAVED, repeat: BOOKING_COLOR_DEFAULTS.repeat })
  })

  it('one key missing → its default, the others kept; extra keys ignored', () => {
    const { vip: _vip, ...three } = SAVED
    expect(bookingColorsFor(S, { [S]: three })).toEqual({ ...SAVED, vip: BOOKING_COLOR_DEFAULTS.vip })
    expect(bookingColorsFor(S, { [S]: { ...SAVED, extra: '#000000', other: '#ffffff' } })).toEqual(SAVED)
  })

  it('the result always has exactly the four keys', () => {
    for (const raw of [null, { [S]: SAVED }, { [S]: { ...SAVED, extra: '#000000' } }, { [S]: {} }]) {
      expect(Object.keys(bookingColorsFor(S, raw)).sort()).toEqual([...KEYS].sort())
    }
  })

  it('an inherited key is not a saved store (own properties only)', () => {
    expect(bookingColorsFor('toString', {})).toEqual(BOOKING_COLOR_DEFAULTS)
    expect(bookingColorsFor(S, Object.create({ [S]: SAVED }))).toEqual(BOOKING_COLOR_DEFAULTS)
  })
})

describe('(c) never throws', () => {
  const bare = Object.create(null) as Record<string, unknown>
  bare['store-1'] = Object.assign(Object.create(null), SAVED)
  it.each([
    ['Object.create(null), empty', Object.create(null)],
    ['Object.create(null), saved', bare],
    ['a frozen object', Object.freeze({ 'store-1': Object.freeze({ ...SAVED }) })],
    ['a number', 42],
  ])('%s', (_name, raw) => {
    expect(() => bookingColorsFor('store-1', raw)).not.toThrow()
    expect(() => bookingColorsFor(null, raw)).not.toThrow()
  })
  it('the null-prototype saved map still resolves', () => {
    expect(bookingColorsFor('store-1', bare)).toEqual(SAVED)
  })
})

describe('(d) bookingColorHex — the store\'s own entry, else \'\', else nothing', () => {
  const MAP: Record<string, BookingColors> = { '': BOOKING_COLOR_DEFAULTS, 'store-1': SAVED }
  const CATS = KEYS as Array<keyof BookingColors>
  it.each(CATS)('store present → that store\'s hex (%s)', (cat) => {
    expect(bookingColorHex(MAP, 'store-1', cat)).toBe(SAVED[cat])
  })
  it.each(CATS)('store absent from the map → the \'\' entry (%s)', (cat) => {
    expect(bookingColorHex(MAP, 'store-2', cat)).toBe(BOOKING_COLOR_DEFAULTS[cat])
  })
  it.each(CATS)('store null / undefined → the \'\' entry (%s)', (cat) => {
    expect(bookingColorHex(MAP, null, cat)).toBe(BOOKING_COLOR_DEFAULTS[cat])
    expect(bookingColorHex(MAP, undefined, cat)).toBe(BOOKING_COLOR_DEFAULTS[cat])
  })
  it('no \'\' entry and the store absent → undefined', () => {
    for (const cat of CATS) {
      expect(bookingColorHex({ 'store-1': SAVED }, 'store-2', cat)).toBeUndefined()
      expect(bookingColorHex({ 'store-1': SAVED }, null, cat)).toBeUndefined()
    }
  })
  it('no category, or one the map does not carry → undefined', () => {
    for (const cat of [null, undefined, '', 'other', 'toString', 'constructor', '__proto__']) {
      expect(bookingColorHex(MAP, 'store-1', cat)).toBeUndefined()
    }
  })
})
