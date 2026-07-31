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

// ── memoContent (2026-07-03): the brief must never show the QR back-reference
// as 「ご予約時のメモ」 (Liam's bug report: brief displayed "QR #328091" while
// the customer's real intake memo existed on customer.notes). ──
import { memoContent } from '@/lib/sync/qr-notes'

describe('memoContent', () => {
  it('bare QR tag (no pipe) is plumbing → null', () => {
    expect(memoContent('QR #328091')).toBeNull()
  })
  it('QR tag with empty memo after the pipe → null', () => {
    expect(memoContent('QR #328091 | ')).toBeNull()
    expect(memoContent('QR #328091 |')).toBeNull()
  })
  it('QR-prefixed real memo → the memo without the tag', () => {
    expect(memoContent('QR #328091 | 口コミOK お尻硬い')).toBe('口コミOK お尻硬い')
  })
  it('plain hand-typed memo passes through', () => {
    expect(memoContent('腰が痛いので優しめでお願いします')).toBe('腰が痛いので優しめでお願いします')
  })
  it('a memo that merely mentions QR mid-string is kept whole', () => {
    expect(memoContent('前回はQR #99の件で来店')).toBe('前回はQR #99の件で来店')
  })
  it('null/empty → null', () => {
    expect(memoContent(null)).toBeNull()
    expect(memoContent('   ')).toBeNull()
  })
})

// ── parseQrMemo (2026-07-04): the shared ▶key:value parser reused by both the
// カルテ customer tab (BookingMemoCard) and the pre-session briefing. Pinned here
// so the format can't drift out from under either surface. Empty values are KEPT
// (as '') — the briefing omits them at render, the customer tab shows a dash. ──
import { parseQrMemo } from '@/lib/sync/qr-notes'

describe('parseQrMemo', () => {
  it('parses ▶key:value segments into label-mapped rows, in order', () => {
    expect(parseQrMemo('▶症状:肩こり▶ゴール:楽になりたい▶セルフ:ストレッチ')).toEqual([
      { label: '症状・お悩み', value: '肩こり' },
      { label: 'ゴール', value: '楽になりたい' },
      { label: 'セルフケア', value: 'ストレッチ' },
    ])
  })

  it('strips the QR back-reference prefix before parsing', () => {
    expect(parseQrMemo('QR #328091 | ▶症状:肩こり')).toEqual([
      { label: '症状・お悩み', value: '肩こり' },
    ])
  })

  it('keeps empty-value segments as "" (caller decides how to show them)', () => {
    expect(parseQrMemo('▶症状:肩こり▶quick:')).toEqual([
      { label: '症状・お悩み', value: '肩こり' },
      { label: 'quick', value: '' },
    ])
  })

  it('maps 参考 to 備考 and accepts a full-width colon', () => {
    expect(parseQrMemo('▶参考：口コミOK')).toEqual([{ label: '備考', value: '口コミOK' }])
  })

  it('falls back to the raw key for an unknown key', () => {
    expect(parseQrMemo('▶体温:36.5')).toEqual([{ label: '体温', value: '36.5' }])
  })

  it('returns null when there is no ▶ structure (raw-text fallback)', () => {
    expect(parseQrMemo('腰が痛いので優しめでお願いします')).toBeNull()
    expect(parseQrMemo('QR #328091 | 口コミOK お尻硬い')).toBeNull()
  })
})
