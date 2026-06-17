/**
 * The QR-notes back-reference is the ONLY place the QuickReserve reservation id
 * is stored (external_refs isn't writable via the SDK yet), so the durable sync
 * keys appointments off it. These tests pin the parser STRICT: anchored to the
 * string start, digits-only, pipe-delimited — so a hand-typed memo can never be
 * mistaken for a QR-owned row (which would otherwise let the cancel-sweep touch
 * a manual booking, or mis-key a move).
 */
import { parseQrId, isQrOwned, stripQrPrefix } from '@/lib/sync/qr-notes'

describe('parseQrId', () => {
  it('extracts the id from a real QR note', () => {
    expect(parseQrId('QR #327563 | リエムさん知り合い')).toBe('327563')
  })

  it('tolerates leading space and no space around #', () => {
    expect(parseQrId('  QR#314702 | memo')).toBe('314702')
  })

  it('returns null when the prefix is absent (manual booking)', () => {
    expect(parseQrId('walk-in, 肩こり')).toBeNull()
    expect(parseQrId('')).toBeNull()
    expect(parseQrId(null)).toBeNull()
    expect(parseQrId(undefined)).toBeNull()
  })

  it('returns null for a non-numeric token (not a real QR id)', () => {
    expect(parseQrId('QR #abc | memo')).toBeNull()
  })

  it('is anchored — a "QR #" appearing mid-string is NOT a key', () => {
    expect(parseQrId('customer asked about QR #123 | their old visit')).toBeNull()
  })

  it('requires the pipe delimiter', () => {
    expect(parseQrId('QR #327563 memo without pipe')).toBeNull()
  })

  it('captures only the first digit run, not a later number', () => {
    // #327 vs a later 3275 — must take 327, never bleed into the memo.
    expect(parseQrId('QR #327 | rebooked from 3275')).toBe('327')
  })

  it('handles a multi-line memo', () => {
    expect(parseQrId('QR #313960 | 首肩こり\n頭痛\n腰痛')).toBe('313960')
  })
})

describe('isQrOwned', () => {
  it('mirrors parseQrId !== null', () => {
    expect(isQrOwned('QR #1 | x')).toBe(true)
    expect(isQrOwned('manual note')).toBe(false)
  })
})

describe('stripQrPrefix', () => {
  it('removes the prefix and trims', () => {
    expect(stripQrPrefix('QR #327563 | ▶症状:肩こり')).toBe('▶症状:肩こり')
  })

  it('leaves a non-QR note untouched (no false strip)', () => {
    expect(stripQrPrefix('QR #abc | not a real id')).toBe('QR #abc | not a real id')
    expect(stripQrPrefix('plain memo')).toBe('plain memo')
  })

  it('returns empty string for nullish', () => {
    expect(stripQrPrefix(null)).toBe('')
    expect(stripQrPrefix(undefined)).toBe('')
  })
})
