// Item 102 fix batch 3 (S113: R-S113-4/5/6, PACKET-FIX3-ERRREP-S113.md).
// Each describe block is one commit (M1-M10). Plants are built from parts.
import { guardHits, isVersion, maskSensitive } from '@/lib/text/mask-sensitive'
import { buildAlarmItem, buildEnvelopeHeader, buildErrorEvent, buildSpan, fixedId, frameFile, masked, path, spaced, token } from '@/lib/observability/sentry-exit'

const P = (sep: string, lead = '090') => [lead, '1234', '5678'].join(sep)
const DIGITS = /1234|5678/

describe('M1 separators: gaps of 1-3 characters, the widened class (R-S113-5 D1/D2, R-S113-6 F-S113-1)', () => {
  const FORMS = [
    P(' - '), `(090) 1234 - 5678`, `090 ( 1234 ) 5678`, ['+81', '90', '1234', '5678'].join(' - '),
    `tel\t${P('\t')}`, P('\n'), P('+'), P('_'), P(','), P('・'), P('〜'), P('～'),
    P(' – '), P('⁃'), P('➖'), P('゠'), P('\r\n'),
  ]
  it.each(FORMS)('%j is masked in text and dropped at spaced', (f) => {
    const v = `bad ${f} x`
    for (const out of [maskSensitive(v), masked(v, 200) ?? '']) expect(out).not.toMatch(DIGITS)
    expect(guardHits(v)).toBe(true)
    expect(spaced(v, 200)).toBeUndefined()
  })
  it.each(['+', '_', '/'])('joined by %j: dropped at token', (sep) => {
    expect(token(`v${P(sep)}`, 60)).toBeUndefined()
  })
  it.each(['+', '_', ','])('joined by %j: dropped inside one path segment', (sep) => {
    expect(path(`/a/${P(sep)}/b`, 200)).toBeUndefined()
  })
  it('recorded trade: a phone split across PATH segments passes (per-segment rule, R-S112-7)', () => {
    expect(path(`/a/${P('/')}`, 200)).toBe(`/a/${P('/')}`)
  })
  it('accepted over-masking: a date-plus-id route inside error TEXT masks to <phone>', () => {
    expect(maskSensitive('GET /api/2026/10/08/12345 failed')).toBe('GET /api/<phone> failed')
    expect(path('/api/2026/10/08/12345', 200)).toBe('/api/2026/10/08/12345')
  })
  it.each(['connect ECONNREFUSED 127.0.0.1:3100', '192.168.1.100:8080'])(
    'R-S113-10: %j (an address and port) is unchanged in text and kept at spaced',
    (v) => {
      expect(maskSensitive(v)).toBe(v)
      expect(masked(v, 200)).toBe(v)
      expect(guardHits(v)).toBe(false)
      expect(spaced(v, 200)).toBe(v)
    },
  )
  it('R-S113-10 named trade: a phone joined by colons passes', () => {
    const v = `tel ${P(':')}`
    expect(maskSensitive(v)).toBe(v)
    expect(spaced(v, 200)).toBe(v)
  })
  it('isVersion is unchanged by the class (dots only)', () => {
    expect(isVersion('120.0.2210.91')).toBe(true)
  })
})

describe('M2 version shape: first group 0 or not zero-padded, at most one 4+ group (R-S113-4 (b), R-S113-5 D3)', () => {
  const UAS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.129 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Mobile Safari/537.36',
    'Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0',
  ]
  it.each(['120.0.2210.91', '120.0.6099.129', '605.1.15', '537.36', '17.1', '10.51.0', '0.9.1'])('%j is a version', (v) => {
    expect(isVersion(v)).toBe(true)
    expect(maskSensitive(`v ${v}`)).toBe(`v ${v}`)
    expect(spaced(`v ${v}`, 100)).toBe(`v ${v}`)
  })
  it.each(UAS)('%j passes whole (text keeps every version; only the 7+-digit rule touches Gecko/20100101)', (ua) => {
    expect(spaced(ua, 400)).toBe(ua)
    expect(guardHits(ua)).toBe(false)
    const text = ua.replace('Gecko/20100101', 'Gecko/<digits>')
    expect(maskSensitive(ua)).toBe(text)
    expect(masked(ua, 400)).toBe(text)
  })
  const PHONES = [
    P('.'), ['03', '1234', '5678'].join('.'), ['0120', '123', '456'].join('.'), ['81', '90', '1234', '5678'].join('.'),
    ['4111', '1111', '1111', '1111'].join('.'), ['12345', '12345', '12345'].join('.'), `Edg/120.0.2210.91.${P('.')}`,
  ]
  it.each(PHONES)('%j is not a version: masked in text, dropped at spaced and token', (f) => {
    expect(isVersion(f.replace(/^Edg\//, ''))).toBe(false)
    const v = `tel ${f}`
    for (const out of [maskSensitive(v), masked(v, 200) ?? '']) expect(out).toMatch(/<phone>/)
    expect(spaced(v, 200)).toBeUndefined()
    expect(token(f, 60)).toBeUndefined()
  })
  it('recorded trade: a 4-digit build AND a 4-digit patch drops the user-agent at spaced', () => {
    expect(isVersion('130.0.6723.1000')).toBe(false)
    expect(spaced('Mozilla/5.0 Chrome/130.0.6723.1000 Safari/537.36', 400)).toBeUndefined()
  })
})

describe('M3 unbroken digits: no upper bound; only id and hash lengths with a letter are exempt (R-S113-4 (a), R-S113-6)', () => {
  const LONG = ['1234567890', '1234567890'].join('')
  const UNIONPAY = ['622126', '1111111111111'].join('')
  const DEADBEEF = ['deadbeef', '09012345678'].join('')
  it.each([LONG, UNIONPAY, DEADBEEF])('%j drops at path, token and spaced, and is masked in text', (r) => {
    expect(path(`/u/${r}/x`, 200)).toBeUndefined()
    expect(token(`id_${r}`, 60)).toBeUndefined()
    expect(spaced(`ref ${r} x`, 100)).toBeUndefined()
    const out = masked(`ref ${r} x`, 200) ?? ''
    expect(out).toMatch(/<digits>/)
    expect(out).not.toMatch(/0901234|11111111|4567890/)
  })
  const SHA40 = '0123456789abcdef'.repeat(3).slice(0, 40)
  const DIGEST64 = 'a1b2c3d4e5f60718'.repeat(4)
  it.each(['0a1b2c3d4e5f6789', SHA40, DIGEST64])('%j (an id or hash length with a letter) is kept at path, token and spaced', (h) => {
    expect(path(`/_next/static/chunks/${h}.js`, 300)).toBe(`/_next/static/chunks/${h}.js`)
    expect(token(h, 100)).toBe(h)
    expect(spaced(`build ${h}`, 100)).toBe(`build ${h}`)
  })
  it('a 16-digit chunk hash drops its frame field (recorded)', () => {
    expect(path(['/_next/static/chunks/1234-', '0123456789012345.js'].join(''), 300)).toBeUndefined()
  })
})

describe('M4 text positions mask the decoded copy (R-S113-6 F-S113-2)', () => {
  const EID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  const TA = [0xe7, 0x94, 0xb0] // 田
  const enc = (bytes: number[], depth: number) =>
    bytes.map((b) => `%${'25'.repeat(depth - 1)}${b.toString(16).toUpperCase()}`).join('')
  const LEAK = /1234|5678|tanaka|hanako|gmail|a@|b\.jp|E7|94|B0|\u7530/
  const sendAll = (v: string) =>
    JSON.stringify([
      buildErrorEvent({ event_id: EID, exception: { values: [{ type: v, value: v }] } }),
      buildAlarmItem({ event_id: EID, message: v, tags: { alarm: '1' } }),
    ])
  it.each([
    'https://api.example.com/search/090%201234%205678',
    `bad ${['tanaka', 'hanako'].join('.')}%2540gmail.com`,
    'bad a@b%2Ejp x',
    `name ${enc(TA, 2)} x`,
    `name ${enc(TA, 3)} x`,
    `name ${enc(TA, 5)} x`,
  ])('%j leaves no digits, local part or encoded Japanese', (v) => {
    expect(sendAll(v)).not.toMatch(LEAK)
  })
  it('the decoded copy is what leaves at text positions', () => {
    expect(masked('bad a@b%2Ejp x', 200)).toBe('bad <email> x')
    expect(masked(`name ${enc(TA, 3)} x`, 200)).toBe('name <text> x')
  })
  it('decoding fails: every %XX run becomes [enc], the text otherwise intact', () => {
    expect(masked(`name ${enc(TA, 5)} x`, 200)).toBe('name [enc] x')
    expect(masked('upload 100% done', 200)).toBe('upload 100% done')
    expect(masked(`bad 100% ${enc(TA, 1)} x`, 200)).toBe('bad 100% [enc] x')
    expect(masked(enc(TA, 5), 200)).toBeUndefined()
  })
})

describe('M5 data: and blob: are judged on both copies in path() (R-S113-5 D4, R-S113-6 F-S113-3)', () => {
  const EID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  it.each(['data%3Atext/javascript,Tanaka', '%64ata:,abc', '%2564ata:,abc', 'blob%3Ahttps://x.example/abc'])(
    '%j is dropped at frame filename, path and request.url',
    (v) => {
      expect(frameFile(v)).toBeUndefined()
      expect(path(v, 300)).toBeUndefined()
      const e = buildErrorEvent({
        event_id: EID,
        request: { url: v },
        exception: { values: [{ type: 'Error', stacktrace: { frames: [{ filename: v, lineno: 1 }] } }] },
      })
      expect(JSON.stringify(e)).not.toMatch(/Tanaka|abc|ata:|%3A/)
    },
  )
  it('an ordinary encoded path still passes', () => {
    expect(path('/ja/customers/a%2Db', 300)).toBe('/ja/customers/a%2Db')
  })
})

describe('M6 Basic and Token mask only a credential-looking value (R-S113-6 F-S113-4)', () => {
  const SUPA = 'Invalid Refresh Token: Refresh Token Not Found'
  it.each([SUPA, 'Token expired', 'basic validation failed'])('%j keeps its meaning: no <token>, kept at spaced', (v) => {
    expect(maskSensitive(v)).not.toMatch(/<token>/)
    expect(masked(v, 200)).not.toMatch(/<token>/)
    expect(guardHits(v)).toBe(false)
    expect(spaced(v, 200)).toBe(v)
  })
  it.each(['Token expired', 'basic validation failed'])('%j is unchanged in text', (v) => {
    expect(maskSensitive(v)).toBe(v)
    expect(masked(v, 200)).toBe(v)
  })
  it.each([
    ['Token', ['abcdefghijklmnop', '1234'].join('')],
    ['Basic', ['dXNlcjpwYXNz', 'd29yZA=='].join('')],
  ])('%s + a credential value is masked in text and dropped at spaced', (scheme, val) => {
    const v = `${scheme} ${val}`
    expect(maskSensitive(v)).toBe(`${scheme} <token>`)
    expect(masked(`auth ${v} x`, 200)).toBe(`auth ${scheme} <token> x`)
    expect(spaced(v, 200)).toBeUndefined()
  })
  it('Bearer still masks whatever follows', () => {
    expect(maskSensitive('Bearer x')).toBe('Bearer <token>')
    expect(spaced('Bearer x', 100)).toBeUndefined()
  })
})

describe('M7 trace.org_id: digits only, no guard (R-S113-4 (c))', () => {
  it('a 16-digit org id is kept; a name, a 21-digit run and a number are dropped', () => {
    const org = ['45067812', '34567890'].join('')
    expect((buildEnvelopeHeader({ trace: { org_id: org, environment: 'preview' } }).trace as Record<string, unknown>).org_id).toBe(org)
    for (const bad of ['tanaka', '1'.repeat(21), 12345, '12 34']) {
      const t = buildEnvelopeHeader({ trace: { org_id: bad, environment: 'preview' } }).trace as Record<string, unknown>
      expect(t.org_id).toBeUndefined()
    }
  })
})

describe('M8 fixedId(n) is exactly n lowercase hex (R-S113-6)', () => {
  const T32 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  const UUID = '123e4567-e89b-42d3-a456-426614174000'
  const HEX20 = 'a1b2c3d4e5f607182930'
  it('a UUID or a 20-hex at span_id is omitted: the span drops (required field)', () => {
    for (const bad of [UUID, HEX20]) {
      expect(fixedId(bad, 16)).toBeUndefined()
      expect(buildSpan({ span_id: bad, trace_id: T32 })).toBeNull()
    }
    expect(fixedId(UUID, 32)).toBeUndefined()
    expect(buildSpan({ span_id: 'a1b2c3d4e5f60718', trace_id: UUID })).toBeNull()
  })
  it('an all-digit 16 and a 16-hex with letters are kept', () => {
    expect(fixedId('1234567890123456', 16)).toBe('1234567890123456')
    expect(fixedId('a1b2c3d4e5f60718', 16)).toBe('a1b2c3d4e5f60718')
    expect(fixedId(T32, 32)).toBe(T32)
  })
})

describe('M9 a run that starts with a date keeps the date; the rest is judged (R-S113-6 NIT)', () => {
  it('a date-time is unchanged in text and kept at spaced', () => {
    const v = 'at 2024-10-08 12:34:56 failed'
    expect(maskSensitive(v)).toBe(v)
    expect(masked(v, 200)).toBe(v)
    expect(spaced(v, 200)).toBe(v)
  })
  it('a date then a phone: the date stays, the phone is masked (and drops at spaced)', () => {
    const v = `booked 2024-10-08 ${P('-')}`
    expect(maskSensitive(v)).toBe('booked 2024-10-08 <phone>')
    expect(masked(v, 200)).toBe('booked 2024-10-08 <phone>')
    expect(spaced(v, 200)).toBeUndefined()
  })
  it('a date of birth alone is unchanged (it stays in the residual list)', () => {
    expect(maskSensitive('1990-04-12')).toBe('1990-04-12')
  })
  it('R-S113-12: a date prefix needs a real month and day', () => {
    const v = `tel ${['2012-34-56', '7890', '1234'].join(' ')}`
    expect(maskSensitive(v)).toBe('tel <phone>')
    expect(masked(v, 200)).toBe('tel <phone>')
    expect(spaced(v, 200)).toBeUndefined()
  })
  it('a date shape followed by more digits is not a date: judged whole', () => {
    expect(maskSensitive(`tel ${['2012', '34', '5678'].join('-')}`)).toBe('tel <phone>')
  })
})

describe('M10 riders: authorization=, empty frames omitted, local@<non-ASCII domain> (R-S113-6 NITs)', () => {
  const EID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  it('authorization=x is masked in text and dropped at spaced and path', () => {
    // the header rule fires first; the label rule then rewrites its marker (pre-existing order)
    expect(maskSensitive('authorization=x')).toBe('<label>=<redacted>')
    expect(masked('sent authorization=abc', 200)).toBe('sent <label>=<redacted>')
    expect(spaced('authorization=x', 100)).toBeUndefined()
    expect(path('/a/authorization=x', 100)).toBeUndefined()
  })
  it('a stacktrace whose every frame dropped is omitted, not frames: []', () => {
    const e = buildErrorEvent({
      event_id: EID,
      exception: { values: [{ type: 'Error', stacktrace: { frames: [{ filename: 'data:,x' }, 'junk'] } }] },
    })
    const x = (e?.exception as { values: Record<string, unknown>[] }).values[0]
    expect(x.type).toBe('Error')
    expect(x).not.toHaveProperty('stacktrace')
  })
  it('an email whose domain is non-ASCII writing masks whole in text', () => {
    const local = ['tanaka', 'hanako'].join('.')
    for (const dom of ['\u4F8B\u3048.jp', 'mail.\u4F8B\u3048.jp']) {
      expect(maskSensitive(`bad ${local}@${dom} x`)).toBe('bad <email> x')
      expect(masked(`bad ${local}@${dom} x`, 200)).toBe('bad <email> x')
    }
  })
})
