// N3 — the content guard on every string the exit lets out (item 102 fix batch 1;
// R-S112-5 F2, R-S112-6 S1/S2, R-S112-7). Shape positions DROP on a hit; the
// masked pipeline MASKS; the decoded copy and the original are both checked and
// only the untouched ORIGINAL leaves.
/* eslint-disable @typescript-eslint/no-explicit-any -- deep reads of rebuilt output */
import {
  frameFile, masked, MEASUREMENT_NAMES, path, rebuildEnvelope, safeKey, spaced, token, transactionName,
} from '@/lib/observability/sentry-exit'
import { base64Looking, guardContent, pctDecode } from '@/lib/text/mask-sensitive'

const UUID = '3f2b1c4d-1111-4222-8333-444455556666'
const JWT = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'].join('.')
const KEY32 = ['sk_live_', 'Ab3dEf7hIj9kLm2nOp4qRs6t'].join('')
const BLOB200 = Buffer.from(Array.from({ length: 150 }, (_, i) => (i * 37 + 11) % 256)).toString('base64')
const PHONE = '090-1234-5678'

type Pos = [string, (v: string) => unknown]
const SHAPE_POSITIONS: Pos[] = [
  ['token(200)', (v) => token(v, 200)],
  ['path(300)', (v) => path(v, 300)],
  ['spaced(400)', (v) => spaced(v, 400)],
  ['transactionName', (v) => transactionName(v)],
  ['frameFile', (v) => frameFile(v)],
]

describe('the guard — R-S112-7 pass set (unchanged)', () => {
  it.each([
    'app:///_next/static/chunks/a.js',
    '/_next/static/chunks/0a1b2c3d4e5f6789.js',
    '/var/task/.next/server/chunks/ssr/src_lib_app-api_errors_ts_0a1b2c3d._.js',
    `/ja/customers/${UUID}`,
    '/ja/customers/[id]',
    '/ja/%5Blocale%5D/page.js',
    'app/%40modal/page.js',
  ])('%j passes path and frameFile byte-equal', (v) => {
    expect(path(v, 300)).toBe(v)
    expect(frameFile(v)).toBe(v)
  })

  it('a 40-hex release, a UUID, a 16-hex span id and an INP op pass token', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    for (const v of [sha, UUID, '0123456789abcdef', 'ui.interaction.click', 'sentry.javascript.nextjs']) expect(token(v, 200)).toBe(v)
    expect(spaced('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0.0.0 Safari/537.36', 400)).toBeDefined()
  })

  it('base64Looking needs upper, lower and digit and is never a UUID or pure hex', () => {
    expect(base64Looking('abcdefghijklmnopqrstuvwxyz')).toBe(false)
    expect(base64Looking('0123456789ABCDEF0123456789abcdef')).toBe(false)
    expect(base64Looking(UUID.toUpperCase().replace('F', 'f'))).toBe(false)
    expect(base64Looking(KEY32)).toBe(true)
  })
})

describe('the guard — hit set: JWT, 32-char key, 200-char blob, phone, Bearer, Basic', () => {
  const HITS = { JWT, KEY32, BLOB200, PHONE, BEARER: `Bearer ${KEY32.slice(0, 20)}`, BASIC: 'Authorization: Basic dXNlcjpwYXNz' }
  for (const [name, plant] of Object.entries(HITS)) {
    it.each(SHAPE_POSITIONS)(`${name} at %s is dropped`, (_pos, f) => {
      const spacedOk = plant.includes(' ')
      for (const v of spacedOk ? [plant, `x ${plant}`] : [plant, `/a/${plant}`, `/a/${plant}/b.js`, `x_${plant}`]) {
        expect(f(v)).toBeUndefined()
      }
    })
    it(`${name} in the masked pipeline is masked away`, () => {
      const out = masked(`failed for ${plant} ok`, 200) ?? ''
      expect(out).toContain('failed for')
      for (const part of plant.split(/[\s.:/+=-]+/).filter((p) => p.length >= 6 && !['Bearer', 'Authorization'].includes(p))) expect(out).not.toContain(part)
      expect(out).not.toMatch(/\d{3}/)
    })
  }
})

describe('percent-decoding (F2, S1): decoded copy and original both checked; the original leaves', () => {
  it.each([
    '/ja/customers/Tanaka%20Hanako',
    '/u/a%40b%2Ejp',
    '/u/a%2540b.jp',
    '/search/090%2D1234%2D5678',
    '/ja/%E8%97%A4%E4%BA%95',
    '/a/%ZZ',
    '/a/%25252525252540b.jp',
  ])('%j is dropped at path', (v) => {
    expect(path(v, 300)).toBeUndefined()
    expect(frameFile(v)).toBeUndefined()
  })

  it('transaction names with encoded content drop', () => {
    expect(transactionName('GET /ja/customers/Tanaka%20Hanako')).toBeUndefined()
    expect(transactionName('GET /ja/customers/[id]')).toBe('GET /ja/customers/[id]')
  })

  it('spaced: encoded Japanese, encoded email and encoded Bearer drop', () => {
    for (const v of ['onClick %E7%94%B0%E4%B8%AD', 'Mozilla tanaka%40example%2Ecom', 'x Bearer%20Ab3dEf7hIj9kLm2nOp4qRs6t'])
      expect(spaced(v, 400)).toBeUndefined()
  })

  it('data: and blob: values never leave as a path', () => {
    expect(frameFile('data:text/javascript,alert(%22Tanaka%20Hanako%22)')).toBeUndefined()
    expect(path(`blob:https://karute.app/${UUID}`, 300)).toBeUndefined()
    expect(path('DATA:text/plain,x', 300)).toBeUndefined()
  })

  it('pctDecode: stable within 3 rounds, null on failure or no fixpoint', () => {
    expect(pctDecode('a%2540b')).toBe('a@b')
    expect(pctDecode('%E0%A4%A')).toBeNull()
    expect(pctDecode('a%2525252540')).toBeNull()
    expect(pctDecode('/plain')).toBe('/plain')
  })

  it('guardContent masks per segment at paths, never across `/`', () => {
    expect(guardContent('app:///_next/static/chunks/a.js', true)).toBe('app:///_next/static/chunks/a.js')
    expect(guardContent(`/k/${KEY32}/x`, true)).toBe('/k/<blob>/x')
  })
})

describe('the guard through rebuildEnvelope: request.url, span data, frames', () => {
  it('nothing of the content leaves; the controls stay', () => {
    const ev = {
      event_id: 'a'.repeat(32),
      transaction: '/ja/customers/Tanaka%20Hanako',
      request: { url: `https://karute.app/search/${PHONE}`, headers: { 'user-agent': `Mozilla/5.0 Bearer ${KEY32}` } },
      exception: { values: [{ type: 'Error', value: `bad ${JWT}`, stacktrace: { frames: [
        { filename: 'data:text/javascript,x', function: 'onClick %E7%94%B0' },
        { filename: 'app:///_next/static/chunks/a.js', function: 'onClick', lineno: 1 },
      ] } }] },
      contexts: { trace: { trace_id: '0'.repeat(31) + 'f', span_id: '0123456789abcdef', data: { 'http.route': `/r/${BLOB200.slice(0, 40)}`, 'next.route': '/ja/customers/[id]' } } },
    }
    const out = rebuildEnvelope([{}, [[{ type: 'event' }, ev]]])
    const s = JSON.stringify(out)
    for (const bad of ['Tanaka', '1234-5678', KEY32.slice(8), 'eyJ', 'data:', '%E7']) expect(s).not.toContain(bad)
    expect(s).toContain('app:///_next/static/chunks/a.js')
    expect(s).toContain('/ja/customers/[id]')
    expect(s).toContain('0123456789abcdef')
  })
})

describe('N5 safe keys + the measurement allow-list (R-S112-5 F5, R-S112-6 S5)', () => {
  const TX = (extraKeys: string) => JSON.parse(`{
    "event_id": "${'a'.repeat(32)}", "type": "transaction", "transaction": "/ja",
    "measurements": {"__proto__": {"polluted": 1}, "constructor": {"value": 1}, "lcp": {"value": 5, "unit": "millisecond"}${extraKeys}},
    "tags": {"__proto__": {"x": 1}, "business_id": "${UUID}"},
    "contexts": {"__proto__": {"x": 1}, "os": {"__proto__": {"x": 1}, "name": "Mac OS X"}},
    "request": {"headers": {"__proto__": {"x": 1}, "accept": "text/html"}},
    "spans": [{"span_id": "0123456789abcdef", "trace_id": "${'ab'.repeat(16)}",
      "measurements": {"__proto__": {"y": 1}, "inp": {"value": 120, "unit": "millisecond"}}, "data": {"__proto__": {"z": 1}, "sentry.op": "x"}}]
  }`)
  const walkProtos = (v: unknown, path: string, out: string[]) => {
    if (v && typeof v === 'object') {
      if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) out.push(path)
      if (Object.prototype.hasOwnProperty.call(v, '__proto__')) out.push(`${path}.__proto__`)
      for (const [k, x] of Object.entries(v)) walkProtos(x, `${path}.${k}`, out)
    }
  }

  it('every rebuilt object keeps Object.prototype and no own __proto__', () => {
    const drops: string[] = []
    const out = rebuildEnvelope([{}, [[{ type: 'transaction' }, TX('')]]], (t, r) => drops.push(`${t}:${r}`)) as unknown as unknown[]
    const bad: string[] = []
    walkProtos(out, '$', bad)
    expect(bad).toEqual([])
    const tx = (out[1] as unknown[][])[0][1] as Record<string, any>
    expect(Object.getPrototypeOf(tx.measurements)).toBe(Object.prototype)
    expect(Object.keys(tx.measurements)).toEqual(['lcp'])
    expect(tx.spans[0].measurements).toEqual({ inp: { value: 120, unit: 'millisecond' } })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(drops.filter((d) => d === 'measurement:key_not_admitted')).toHaveLength(3)
  })

  it('names, phones and hostnames as measurement keys never leave and are counted', () => {
    const drops: string[] = []
    const keys = ['TanakaHanako', '09012345678', 'tanaka.hanako.example.com']
    const extra = keys.map((k) => `, "${k}": {"value": 1}`).join('')
    const s = JSON.stringify(rebuildEnvelope([{}, [[{ type: 'transaction' }, TX(extra)]]], (t, r) => drops.push(`${t}:${r}`)))
    for (const k of keys) expect(s).not.toContain(k)
    expect(drops.filter((d) => d === 'measurement:key_not_admitted')).toHaveLength(6)
  })

  it('the allow-list holds the SDK web-vital names', () => {
    for (const k of ['cls', 'lcp', 'ttfb', 'ttfb.requestTime', 'fp', 'fcp', 'inp', 'connection.rtt']) expect(MEASUREMENT_NAMES).toContain(k)
    expect(safeKey('__proto__') || safeKey('constructor') || safeKey('prototype')).toBe(false)
    expect(safeKey('lcp')).toBe(true)
  })
})

describe('the guard — unbroken 10-16-digit runs (the F1 rule with zero separators)', () => {
  it('an unbroken phone or card number drops at token and path', () => {
    for (const v of ['09012345678', 'tel09012345678', '4111111111111111']) {
      expect(token(v, 200)).toBeUndefined()
      expect(path(`/ja/customers/${v}`, 300)).toBeUndefined()
    }
    expect(masked('call 09012345678 now', 200)).toBe('call <digits> now')
  })

  it('hex ids holding a long digit run, UUIDs and short numbers still pass', () => {
    const sha = '01234567890123abcdef0123456789abcdef0123'
    expect(token(sha, 100)).toBe(sha)
    expect(path(`/_next/static/chunks/${'1234567890123456'.slice(0, 10)}abcdef.js`, 300)).toBe('/_next/static/chunks/1234567890abcdef.js')
    expect(path(`/ja/customers/${UUID}`, 300)).toBe(`/ja/customers/${UUID}`)
    expect(token('karute@1.2.3', 100)).toBe('karute@1.2.3')
    expect(path('/ja/customers/123456789', 300)).toBe('/ja/customers/123456789')
  })
})
