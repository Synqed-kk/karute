// #1159 fix round 5 (R-S115-15, the final round): the Opus attack and the
// Sonnet read of round 4. Planted values are assembled at run time from parts.
import { masked, rebuildEnvelope } from '@/lib/observability/sentry-exit'
import { describeUnknownThrow } from '@/lib/app-api/errors'
import { decodeText, guardContent, maskSensitive, preBound } from '@/lib/text/mask-sensitive'

const EID = 'a'.repeat(32)
const PW = ['Q7m', 'xrT2'].join('')
const LOCAL = ['tanaka', 'hanako'].join('.')
const log = (v: string) => describeUnknownThrow(new Error(v)).errMessage
const exitOut = (v: string) =>
  JSON.stringify(rebuildEnvelope([{}, [[{ type: 'event' }, { event_id: EID, exception: { values: [{ type: 'Error', value: v }] } }]]] as never))
const leaks = (out: string | undefined, ...parts: string[]) => parts.filter((p) => (out ?? '').includes(p))
/** every UTF-8 byte of s as %XX, n times over (a full re-encoding per round) */
const encN = (s: string, n: number) => {
  let t = s
  for (let i = 0; i < n; i++) t = Array.from(Buffer.from(t, 'utf8'), (b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('')
  return t
}

// ---- R5 chunk 1
describe('R5 1 — the decode runs until the text is stable, on normalised text', () => {
  const forms: Array<[string, string[]]> = [
    [`${LOCAL}${encN('@', 5)}example.com`, ['hanako', 'example']],
    [`${LOCAL}${encN('@', 6)}example.com`, ['hanako', 'example']],
    [`password${encN('=', 5)}${PW}`, [PW]],
    [`password${encN('=', 6)}${PW}`, [PW]],
    [`${LOCAL}％40example.com`, ['hanako', 'example']],
    [`${LOCAL}﹪40example.com`, ['hanako', 'example']],
    [`password％3D${PW}`, [PW]],
    [`password﹪3D${PW}`, [PW]],
  ]
  it.each(forms)('masked(), the log line and exception.value: %s', (v, parts) => {
    expect(leaks(masked(v, 300), ...parts)).toEqual([])
    expect(leaks(log(v), ...parts)).toEqual([])
    expect(leaks(exitOut(v), ...parts)).toEqual([])
  })
  it('six full re-encodings decode back to the character (a 2000-character text holds at most six)', () => {
    expect(decodeText(`a ${encN('@', 6)} b`)).toBe('a @ b')
    expect(encN('@', 7).length).toBeGreaterThan(2000)
  })
  it('only the [enc] marker lengthens: at most 5/3 of the bound, and every caller cuts again', () => {
    expect(decodeText('%FF')).toBe('[enc]')
    expect(decodeText(preBound('%FF '.repeat(700))).length).toBeLessThanOrEqual(3334)
    expect((masked('%FF '.repeat(500), 200) ?? '').length).toBeLessThanOrEqual(200)
    expect(log('%FF '.repeat(700)).length).toBeLessThanOrEqual(201)
  })
  it('each round is bounded again: a text that normalising lengthens (U+FDFA, 18 characters) stays within 5/3 of the bound', () => {
    expect(decodeText(String.fromCharCode(0xfdfa).repeat(2000)).length).toBeLessThanOrEqual(3334)
  })
})

// ---- R5 chunk 2
describe('R5 2 — label forms: nested escapes, quoted brackets, &quot;, PKCE and one-time codes', () => {
  const B = '\\'
  const q = (k: number) => `${B.repeat(k)}"`
  const forms = [
    `Request failed: {${q(3)}password${q(3)}:${q(3)}${PW}${q(3)}}`,
    `{${q(2)}password${q(2)}:${q(2)}${PW}${q(2)}}`,
    `{${q(7)}password${q(7)}:${q(7)}correct ${PW}${q(7)}}`,
    JSON.stringify({ body: JSON.stringify({ body: JSON.stringify({ password: `correct ${PW}` }) }) }),
    `{${q(1)}password${q(1)}:${q(1)}hunt er ${B}n ${PW} ${q(1)}}`,
    `{${q(1)}password${q(1)}:${q(1)}caf${B}u00e9 ${PW}${q(1)}}`,
    `user['password']=${PW}`,
    `user["password"]=${PW}`,
    `{&quot;password&quot;:&quot;correct ${PW}&quot;}`,
    `code_verifier=${PW}`,
    `otp=${PW}`,
    `one_time_code=${PW}`,
    `one-time-code: ${PW}`,
    `oneTimeCode=${PW}`,
  ]
  it.each(forms)('text, log line, exception.value and the guard mask %s', (v) => {
    expect(leaks(masked(v, 400), PW)).toEqual([])
    expect(leaks(maskSensitive(v), PW)).toEqual([])
    expect(leaks(log(v), PW)).toEqual([])
    expect(leaks(exitOut(v), PW)).toEqual([])
    expect(leaks(guardContent(v), PW)).toEqual([])
  })
  it('the text after a closed value is kept', () => {
    expect(maskSensitive(`{${q(3)}password${q(3)}:${q(3)}x y${q(3)}} then ok`)).toBe(`{${q(3)}<label>=<redacted>} then ok`)
    expect(maskSensitive(`{&quot;pin&quot;:&quot;1 2&quot;} then ok`)).toBe('{&quot;<label>=<redacted>} then ok')
  })
  it('kept: a label word with no : or = after it, and words that only hold a new label inside', () => {
    for (const v of ['pinned: yes', 'keyboard=1', 'one time only', 'verified: true', 'hotpot: 3']) expect(maskSensitive(v)).toBe(v)
  })
})

// ---- R5 chunk 3
const nameOf = (name: string) => {
  const e = new Error('x')
  e.name = name
  return describeUnknownThrow(e).errName
}
describe('R5 3+4 — err.name decoded; control characters out of both log fields', () => {
  it('a percent-encoded name is decoded, then masked', () => {
    expect(leaks(nameOf(`password%3D${PW}`), PW)).toEqual([])
    expect(leaks(nameOf(`${LOCAL}%40example.com`), 'hanako', 'example')).toEqual([])
  })
  const NAME_CONTROL = new RegExp('[\\x00-\\x1F\\x7F\\u2028\\u2029]')
  it('no C0 control character (ESC included) or line break in errName', () => {
    for (const n of ['X%1B[31mY', 'X\u001b[31mY', `X\npassword=${PW}`, 'X\rY', 'X%0AY', 'X\u2028Y', 'X\u0000Y\u007f']) {
      const out = nameOf(n)
      expect(out).not.toMatch(NAME_CONTROL)
      expect(leaks(out, PW)).toEqual([])
    }
  })
  it('no C0 control character other than the cut line break in errMessage', () => {
    for (const m of ['boom %1B[31m red', 'boom \u001b[31m red', 'a\u0007b\u0000c', 'x %00 y']) {
      expect(log(m)).not.toMatch(/[\x00-\x1F\x7F]/)
    }
    expect(log('first %1B line\nsecond')).toBe('first line')
  })
  it('a name with runs of spaces, tabs or a decoded control logs as one line with single spaces', () => {
    const TAB = String.fromCharCode(9)
    expect(nameOf(`  Bad${TAB}${TAB}Name   x%1B%1By  `)).toBe('Bad Name x y')
  })
})
