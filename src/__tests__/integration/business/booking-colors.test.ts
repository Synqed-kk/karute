// 予約の色分け — THE FOUR CATEGORY COLOURS HAVE ONE HOME.
//
// `bookingColorsFor` (today-board.ts) turns the business's org settings — the
// door hands their 予約の色分け keys — into one store's four colours; page.tsx
// calls it once per store and TodayScreen only indexes the result.
// ⚖ PKT-S41 R-S41-1 (Liam 9/25 A): each store's four live under ITS OWN key
// `booking_colors:<storeId>`; the legacy `booking_colors` map ({ [storeId]:
// four }) is a read-only fallback. Present wins whole, never a blend.
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
//   (e) ⚖ PKT-S41 — the keys (one home, booking-colors.ts) and the precedence:
//       the store's own key answers ALONE when it holds a plain object; else
//       the legacy map's entry; else the defaults.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOOKING_COLOR_DEFAULTS, bookingColorHex, bookingColorsFor, type BookingColors } from '@/business/lib/today-board'
import { BOOKING_COLORS_KEY, BOOKING_COLORS_KEY_PREFIX, bookingColorsKeyFor } from '@/business/lib/booking-colors'

const SAVED: BookingColors = { new: '#112233', repeat: '#445566', ticket: '#778899', vip: '#aabbcc' }
const KEYS = ['new', 'repeat', 'ticket', 'vip']
/** The LEGACY shape: settings holding the one shared per-store map. */
const L = (map: unknown) => ({ booking_colors: map })

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
    ['unknown store', 'store-2', L({ [S]: SAVED })],
    ['storeId null with a saved map', null, L({ [S]: SAVED })],
    ['a bare legacy map (not under its key)', S, { [S]: SAVED }],
  ])('%s → the defaults', (_name, id, raw) => {
    expect(bookingColorsFor(id as string | null, raw)).toEqual(BOOKING_COLOR_DEFAULTS)
  })

  it('a saved store with all four valid → its four, lowercase', () => {
    const upper = { new: '#AABBCC', repeat: '#445566', ticket: '#778899', vip: '#A1B2C3' }
    expect(bookingColorsFor(S, L({ [S]: SAVED }))).toEqual(SAVED)
    expect(bookingColorsFor(S, L({ [S]: upper }))).toEqual({ new: '#aabbcc', repeat: '#445566', ticket: '#778899', vip: '#a1b2c3' })
  })

  it('one key uppercase → lowercase; the others kept', () => {
    expect(bookingColorsFor(S, L({ [S]: { ...SAVED, new: '#3D7AB8' } }))).toEqual({ ...SAVED, new: '#3d7ab8' })
  })

  it.each([
    ['#abc (short form)', '#abc'],
    ['a colour name', 'red'],
    ['rgb()', 'rgb(1, 2, 3)'],
    ['7+ hex digits', '#1122334'],
    ['no hash', '112233'],
    ['a number', 0x112233],
  ])('one key %s → that key\'s default, the others kept', (_name, bad) => {
    expect(bookingColorsFor(S, L({ [S]: { ...SAVED, repeat: bad } }))).toEqual({ ...SAVED, repeat: BOOKING_COLOR_DEFAULTS.repeat })
  })

  it('one key missing → its default, the others kept; extra keys ignored', () => {
    const { vip: _vip, ...three } = SAVED
    expect(bookingColorsFor(S, L({ [S]: three }))).toEqual({ ...SAVED, vip: BOOKING_COLOR_DEFAULTS.vip })
    expect(bookingColorsFor(S, L({ [S]: { ...SAVED, extra: '#000000', other: '#ffffff' } }))).toEqual(SAVED)
  })

  it('the result always has exactly the four keys', () => {
    for (const raw of [null, L({ [S]: SAVED }), L({ [S]: { ...SAVED, extra: '#000000' } }), L({ [S]: {} }), { [bookingColorsKeyFor(S)]: { ...SAVED, extra: '#000000' } }]) {
      expect(Object.keys(bookingColorsFor(S, raw)).sort()).toEqual([...KEYS].sort())
    }
  })

  it('an inherited key is not a saved store (own properties only)', () => {
    expect(bookingColorsFor('toString', {})).toEqual(BOOKING_COLOR_DEFAULTS)
    expect(bookingColorsFor(S, L(Object.create({ [S]: SAVED })))).toEqual(BOOKING_COLOR_DEFAULTS)
    expect(bookingColorsFor(S, Object.create(L({ [S]: SAVED })))).toEqual(BOOKING_COLOR_DEFAULTS)
    expect(bookingColorsFor(S, Object.create({ [bookingColorsKeyFor(S)]: SAVED }))).toEqual(BOOKING_COLOR_DEFAULTS)
  })
})

describe('(c) never throws', () => {
  const bare = Object.create(null) as Record<string, unknown>
  bare['store-1'] = Object.assign(Object.create(null), SAVED)
  it.each([
    ['Object.create(null), empty', Object.create(null)],
    ['Object.create(null), saved (legacy)', L(bare)],
    ['Object.create(null) settings', Object.assign(Object.create(null), { [bookingColorsKeyFor('store-1')]: bare['store-1'] })],
    ['a frozen object', Object.freeze(L(Object.freeze({ 'store-1': Object.freeze({ ...SAVED }) })))],
    ['a number', 42],
  ])('%s', (_name, raw) => {
    expect(() => bookingColorsFor('store-1', raw)).not.toThrow()
    expect(() => bookingColorsFor(null, raw)).not.toThrow()
  })
  it('the null-prototype saved map still resolves (legacy map, and a null-prototype per-store value)', () => {
    expect(bookingColorsFor('store-1', L(bare))).toEqual(SAVED)
    expect(bookingColorsFor('store-1', { [bookingColorsKeyFor('store-1')]: bare['store-1'] })).toEqual(SAVED)
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

describe('(e) ⚖ PKT-S41 R-S41-1 — one key per store; the legacy map is the fallback; present wins whole', () => {
  const S = 'store-1'
  const OTHER: BookingColors = { new: '#3b6fd4', repeat: '#7a5bd4', ticket: '#c25a8f', vip: '#3f4a7d' }
  it('the keys: one home, exact literals', () => {
    expect(BOOKING_COLORS_KEY).toBe('booking_colors')
    expect(BOOKING_COLORS_KEY_PREFIX).toBe('booking_colors:')
    expect(bookingColorsKeyFor('x')).toBe('booking_colors:x')
    expect(bookingColorsKeyFor(S)).toBe(`${BOOKING_COLORS_KEY_PREFIX}${S}`)
  })
  it('the store’s own key present → it answers ALONE; a legacy entry with different colours is ignored', () => {
    expect(bookingColorsFor(S, { [bookingColorsKeyFor(S)]: SAVED, ...L({ [S]: OTHER }) })).toEqual(SAVED)
    expect(bookingColorsFor(S, { [bookingColorsKeyFor(S)]: SAVED })).toEqual(SAVED)
  })
  it('own key present with one bad hex → THAT key’s default, never the legacy value (present wins whole)', () => {
    expect(bookingColorsFor(S, { [bookingColorsKeyFor(S)]: { ...SAVED, ticket: '#abc' }, ...L({ [S]: OTHER }) })).toEqual({ ...SAVED, ticket: BOOKING_COLOR_DEFAULTS.ticket })
  })
  it('own key an empty object → the four defaults, never the legacy entry', () => {
    expect(bookingColorsFor(S, { [bookingColorsKeyFor(S)]: {}, ...L({ [S]: OTHER }) })).toEqual(BOOKING_COLOR_DEFAULTS)
  })
  it.each([
    ['a string', '#112233'],
    ['an array', [SAVED.new, SAVED.repeat, SAVED.ticket, SAVED.vip]],
    ['null', null],
    ['a number', 7],
    ['an object with a prototype', Object.assign(Object.create({ inherited: true }), SAVED)],
  ])('own key not a plain object (%s) → the legacy entry answers', (_name, bad) => {
    expect(bookingColorsFor(S, { [bookingColorsKeyFor(S)]: bad, ...L({ [S]: OTHER }) })).toEqual(OTHER)
  })
  it('neither shape for this store → the defaults (another store’s own key never answers for it)', () => {
    expect(bookingColorsFor(S, {})).toEqual(BOOKING_COLOR_DEFAULTS)
    expect(bookingColorsFor(S, { [bookingColorsKeyFor('store-2')]: SAVED, ...L({ 'store-2': OTHER }) })).toEqual(BOOKING_COLOR_DEFAULTS)
  })
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])('storeId %s → the defaults, never throws', (id) => {
    for (const raw of [{}, L({}), { [bookingColorsKeyFor(S)]: SAVED, ...L({ [S]: OTHER }) }, Object.create(null)]) {
      expect(() => bookingColorsFor(id, raw)).not.toThrow()
      expect(bookingColorsFor(id, raw)).toEqual(BOOKING_COLOR_DEFAULTS)
    }
  })
  it('both shapes absent and storeId null → the defaults; storeId null with both shapes present → still the defaults', () => {
    expect(bookingColorsFor(null, {})).toEqual(BOOKING_COLOR_DEFAULTS)
    expect(bookingColorsFor(null, { [bookingColorsKeyFor(S)]: SAVED, ...L({ [S]: OTHER }) })).toEqual(BOOKING_COLOR_DEFAULTS)
  })
  it('the whole settings object works the same as the subset (the resolver reads only its own keys)', () => {
    const settings = { business_type: 'beauty', reserve_card_color: '#1C2247', [bookingColorsKeyFor(S)]: SAVED, ...L({ [S]: OTHER, 'store-2': OTHER }) }
    expect(bookingColorsFor(S, settings)).toEqual(SAVED)
    expect(bookingColorsFor('store-2', settings)).toEqual(OTHER)
  })
})
