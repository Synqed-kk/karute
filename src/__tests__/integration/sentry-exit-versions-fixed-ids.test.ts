// R-S112-8 (S113 delta): (a) version strings are exempt from the phone/digit
// rule; (b) fixed-length hex ids (span_id 16, trace_id / event_id 32) need no
// a-f letter, while the generic id() keeps the F3 letter rule.
import { guardHits, isVersion, maskSensitive } from '@/lib/text/mask-sensitive'
import { buildSpan, fixedId, id, masked, spaced } from '@/lib/observability/sentry-exit'
import { F1_FORMS, VERSION_SHAPED_PHONE } from './helpers/sentry-exit-plants'

const EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91'
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36'

const FW = F1_FORMS.find((f) => f.includes('０'))!
const PLUS81 = F1_FORMS.filter((f) => f.includes('+81'))
const HIDDEN = [
  'Edg/120.0.2210.91 09012345678',
  'Edg/120.0.2210.91 090-1234-5678',
  ...PLUS81.map((f) => `${EDGE} ${f}`),
  `${EDGE} ${FW}`,
]

describe('R-S112-8 (a) version strings are not numbers', () => {
  it.each([EDGE, CHROME, SAFARI, ANDROID])('%j passes spaced(), the guard and maskSensitive whole', (ua) => {
    expect(spaced(ua, 400)).toBe(ua)
    expect(guardHits(ua)).toBe(false)
    expect(maskSensitive(ua)).toBe(ua)
    expect(masked(ua, 400)).toBe(ua)
  })

  it('isVersion: dots only, 2+ groups, every group <= 5 digits, the whole run', () => {
    for (const v of ['120.0.2210.91', '17.1', '604.1', '120.0.6099.230', '12345.1']) expect(isVersion(v)).toBe(true)
    for (const v of ['123456.1', '120', '090.1234-5678', '090 1234.5678', '+81.90.1234.5678', '1..2', '1.2.', '12345.12345'])
      expect(isVersion(v)).toBe(false)
  })

  it.each(HIDDEN)('%j: a phone hidden in a user-agent is dropped at spaced and masked in text', (v) => {
    expect(spaced(v, 400)).toBeUndefined()
    expect(guardHits(v) || v !== v.normalize('NFKC')).toBe(true)
    for (const out of [maskSensitive(v), masked(v, 400) ?? '']) {
      expect(out).not.toMatch(/1234|5678|09012345678/)
    }
  })

  it('a phone with a dot AND another separator is not a version: masked, guard hit', () => {
    for (const v of ['tel 090.1234-5678', 'tel 090 1234.5678']) {
      expect(maskSensitive(v)).toBe('tel <phone>')
      expect(guardHits(v)).toBe(true)
      expect(spaced(v, 100)).toBeUndefined()
    }
  })

  it('R-S113-4 (b): a dots-only Japanese phone is no longer a version: masked, guard hit', () => {
    expect(maskSensitive(VERSION_SHAPED_PHONE)).toBe('tel <phone>')
    expect(guardHits(VERSION_SHAPED_PHONE)).toBe(true)
  })
})

describe('R-S112-8 (b) fixed-length hex ids need no letter', () => {
  const D16 = '1234567890123456'
  const D32 = '12345678901234567890123456789012'

  it('an all-digit 16-hex span_id and 32-hex trace_id pass; the span is kept', () => {
    expect(fixedId(D16, 16)).toBe(D16)
    expect(fixedId(D32, 32)).toBe(D32)
    const span = buildSpan({ span_id: D16, trace_id: D32, parent_span_id: D16 })
    expect(span).not.toBeNull()
    expect(span?.span_id).toBe(D16)
    expect(span?.trace_id).toBe(D32)
    // R-S113-1: parent_span_id and segment_id are span ids (16 hex) too
    expect(span?.parent_span_id).toBe(D16)
  })

  it('R-S113-1: all-digit parent_span_id and segment_id pass; 15/17 fail', () => {
    const ok = buildSpan({ span_id: D16, trace_id: D32, parent_span_id: D16, segment_id: D16 })
    expect(ok?.parent_span_id).toBe(D16)
    expect(ok?.segment_id).toBe(D16)
    for (const bad of ['1'.repeat(15), '1'.repeat(17)]) {
      const sp = buildSpan({ span_id: D16, trace_id: D32, parent_span_id: bad, segment_id: bad })
      expect(sp).not.toBeNull()
      expect(sp?.parent_span_id).toBeUndefined()
      expect(sp?.segment_id).toBeUndefined()
    }
  })

  it('wrong length fails the fixed field; upper case fails like id()', () => {
    expect(fixedId('1'.repeat(15), 16)).toBeUndefined()
    expect(fixedId('1'.repeat(17), 16)).toBeUndefined()
    expect(fixedId(D16, 32)).toBeUndefined()
    expect(fixedId('1'.repeat(31), 32)).toBeUndefined()
    expect(fixedId('ABCDEF7890123456', 16)).toBeUndefined()
    expect(buildSpan({ span_id: '1'.repeat(17), trace_id: D32 })).toBeNull()
  })

  it('the generic id() keeps the letter rule (F3)', () => {
    expect(id('4111111111111111')).toBeUndefined()
    expect(id(D32)).toBeUndefined()
    expect(id('0123456789abcdef')).toBe('0123456789abcdef')
  })
})
