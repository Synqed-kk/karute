/**
 * Unit coverage for the JP phone formatters added in PR #81
 * (replay/06-foundation-libs).
 */
import { formatJpPhone, formatJpPhoneProgressive } from '@/lib/format/phone'

describe('formatJpPhone (strict, fully-typed values)', () => {
  it('returns "" for empty / nullish / whitespace', () => {
    expect(formatJpPhone('')).toBe('')
    expect(formatJpPhone(null)).toBe('')
    expect(formatJpPhone(undefined)).toBe('')
    expect(formatJpPhone('   ')).toBe('')
  })

  it('formats mobile numbers as 3-4-4', () => {
    expect(formatJpPhone('09012345678')).toBe('090-1234-5678')
    expect(formatJpPhone('08012345678')).toBe('080-1234-5678')
    expect(formatJpPhone('07012345678')).toBe('070-1234-5678')
  })

  it('formats Tokyo (03) / Osaka (06) landlines as 2-4-4', () => {
    expect(formatJpPhone('0312345678')).toBe('03-1234-5678')
    expect(formatJpPhone('0612345678')).toBe('06-1234-5678')
  })

  it('formats other 10-digit landlines as 3-3-4', () => {
    expect(formatJpPhone('0521234567')).toBe('052-123-4567')
    expect(formatJpPhone('0123456789')).toBe('012-345-6789')
  })

  it('strips +81 international prefix', () => {
    expect(formatJpPhone('+819012345678')).toBe('090-1234-5678')
    expect(formatJpPhone('+81 90 1234 5678')).toBe('090-1234-5678')
  })

  it('is idempotent on already-formatted input', () => {
    expect(formatJpPhone('090-1234-5678')).toBe('090-1234-5678')
  })

  it('passes through unrecognized / foreign numbers unchanged', () => {
    expect(formatJpPhone('12345')).toBe('12345')
    expect(formatJpPhone('+1 415 555 0100')).toBe('+1 415 555 0100')
    expect(formatJpPhone('not a phone')).toBe('not a phone')
  })
})

describe('formatJpPhoneProgressive (live, as-you-type)', () => {
  it('returns "" for empty / nullish / non-digit input', () => {
    expect(formatJpPhoneProgressive('')).toBe('')
    expect(formatJpPhoneProgressive(null)).toBe('')
    expect(formatJpPhoneProgressive(undefined)).toBe('')
    expect(formatJpPhoneProgressive('abc')).toBe('')
  })

  it('inserts dashes progressively for mobile', () => {
    expect(formatJpPhoneProgressive('080')).toBe('080')
    expect(formatJpPhoneProgressive('0800000')).toBe('080-0000')
    expect(formatJpPhoneProgressive('08000000006')).toBe('080-0000-0006')
  })

  it('inserts dashes progressively for Tokyo/Osaka landlines', () => {
    expect(formatJpPhoneProgressive('03')).toBe('03')
    expect(formatJpPhoneProgressive('031234')).toBe('03-1234')
    expect(formatJpPhoneProgressive('0312345678')).toBe('03-1234-5678')
  })

  it('inserts dashes progressively for other landlines (3-3-4)', () => {
    expect(formatJpPhoneProgressive('052')).toBe('052')
    expect(formatJpPhoneProgressive('0521234567')).toBe('052-123-4567')
  })

  it('strips embedded separators when pasting', () => {
    expect(formatJpPhoneProgressive('080.0000.0006')).toBe('080-0000-0006')
  })

  it('caps at 11 digits (longest JP mobile)', () => {
    expect(formatJpPhoneProgressive('080000000069999')).toBe('080-0000-0006')
  })
})
