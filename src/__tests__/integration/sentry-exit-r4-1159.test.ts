// #1159 fix round 4 (R-S115-10): the Opus attack and the Sonnet read of
// round 3. Planted values are assembled at run time from parts.
import { masked, path, rebuildEnvelope, spaced } from '@/lib/observability/sentry-exit'
import { describeUnknownThrow } from '@/lib/app-api/errors'
import { decodeText, guardContent, maskSensitive, preBound } from '@/lib/text/mask-sensitive'

const EID = 'a'.repeat(32)
const PW = ['Q7m', 'xrT2'].join('')
const LOCAL = ['tanaka', 'hanako'].join('.')
const log = (v: string) => describeUnknownThrow(new Error(v)).errMessage
const exitOut = (v: string) =>
  JSON.stringify(rebuildEnvelope([{}, [[{ type: 'event' }, { event_id: EID, exception: { values: [{ type: 'Error', value: v }] } }]]] as never))
const leaks = (out: string | undefined, ...parts: string[]) => parts.filter((p) => (out ?? '').includes(p))

describe('R4 SF2 — an escaped-quote JSON label (a JSON body inside a string)', () => {
  const forms = [
    `Request failed: {\\"password\\":\\"${PW}\\"}`,
    `password:\\"${PW}\\"`,
    `body: "{\\"pin\\":\\"${PW}\\"}"`,
    `{\\"access_token\\":\\"${PW}\\",\\"x\\":1}`,
    `{\\"password\\":\\"a\\\\\\"${PW} b\\"}`,
    `password="a\\"${PW} b"`,
  ]
  it.each(forms)('the text masks %s', (v) => {
    expect(leaks(masked(v, 300), PW)).toEqual([])
    expect(leaks(maskSensitive(v), PW)).toEqual([])
  })
  it.each(forms)('the log line masks %s', (v) => expect(leaks(log(v), PW)).toEqual([]))
  it.each(forms)('exception.value at the exit masks %s', (v) => expect(leaks(exitOut(v), PW)).toEqual([]))
  it.each(forms)('a shape position (the guard) masks, so the field drops: %s', (v) => {
    expect(leaks(guardContent(v), PW)).toEqual([])
    expect(spaced(`Mozilla/5.0 ${v}`, 400)).toBeUndefined()
  })
})

describe('R4 SF3 — each percent-encoded run decodes on its own', () => {
  const forms = [
    `100% ${LOCAL}%2540example.com`,
    `100% /cb?code=x&email=${LOCAL}%2540example.com`,
    `redirect=%2Flogin%3Ftoken%3D${PW} at 100%`,
    `50%25 off password%3D${PW}`,
    `%s failed password%3A${PW}`,
    `bad %E3%8 run, then password%3D${PW}`,
  ]
  it.each(forms)('the exit text, the log line and exception.value: %s', (v) => {
    expect(leaks(masked(v, 300), PW, 'hanako', 'example')).toEqual([])
    expect(leaks(log(v), PW, 'hanako', 'example')).toEqual([])
    expect(leaks(exitOut(v), PW, 'hanako', 'example')).toEqual([])
  })
  // the header: an email cannot leave with its @ encoded to any depth, beside
  // a stray % and a run that does not decode
  const AT = ['%40', '%2540', '%252540', '%25252540', '%2525252540', '%25252525252525252540']
  it.each(AT)('an email whose @ is %s leaves no part', (at) => {
    const v = `100% off, bad %FF%FE then ${LOCAL}${at}example.com`
    expect(leaks(masked(v, 300), 'hanako', 'example')).toEqual([])
    expect(leaks(log(v), 'hanako', 'example')).toEqual([])
    expect(leaks(exitOut(v), 'hanako', 'example')).toEqual([])
  })
  it('a run that fails becomes [enc] (its ASCII codes still decode); decoding never lengthens', () => {
    const v = 'a %E3%8 b %FF%3D c %3D d 100%'
    expect(decodeText(v)).toBe('a [enc]%8 b [enc]= c = d 100%')
    for (const s of [v, ...forms, ...AT]) expect(decodeText(s).length).toBeLessThanOrEqual(s.length)
  })
})

describe('R4 SF4 — a label with a bounded suffix or in brackets', () => {
  const forms = [
    `token_hash=${PW}`, `/auth/confirm?token_hash=${PW}&type=recovery`, `user[password]=${PW}`,
    `password[]=${PW}`, `token[0]=${PW}`, `pinCode=${PW}`, `pin_code=${PW}`, `passwordHash=${PW}`,
    `tokenValue=${PW}`, `secret_value: ${PW}`, `password_confirmation=${PW}`, `passwordNew=${PW}`,
    `api_key_id=${PW}`, `user[password_confirm]=${PW}`, `token-digest: ${PW}`,
  ]
  it.each(forms)('text, log line and guard mask %s', (v) => {
    expect(leaks(masked(v, 300), PW)).toEqual([])
    expect(leaks(log(v), PW)).toEqual([])
    expect(leaks(guardContent(v), PW)).toEqual([])
    if (!v.includes('?')) expect(path(`/a/${v}`, 300)).toBeUndefined()
  })
  it.each(['keyboard=1', 'authenticated=true', 'tokenizer: x', 'sessionStorage: full', 'passthrough=1', 'pinned: yes', 'token_type=bearer'])(
    'an open identifier tail is not eaten: %s',
    (v) => expect(maskSensitive(v)).toBe(v),
  )
})

describe('R4 F2 — the second bound after NFKC', () => {
  it('a text that NFKC lengthens (U+FDFA x2100) is still within the bound', () => {
    expect(preBound('ﷺ'.repeat(2100)).length).toBeLessThanOrEqual(2000)
  })
})

describe('R4 N2 — the Japanese dash and comma family are phone separators', () => {
  const SEPS = ['─', '━', '、', '､', 'ー', 'ｰ', '‐', '‑', '‒', '–', '—', '―', '−']
  it.each(SEPS)('%s as a separator: 090-1234-5678 is masked whole at the exit and on the log line', (sep) => {
    const v = `TEL ${['090', '1234', '5678'].join(sep)}`
    expect(leaks(masked(v, 300), '1234', '5678')).toEqual([])
    expect(leaks(log(v), '1234', '5678')).toEqual([])
    expect(leaks(exitOut(v), '1234', '5678')).toEqual([])
  })
  it('common text: a date and a short list are unchanged; a list of 10-16 digits is now a phone', () => {
    expect(maskSensitive('2026ー10ー09')).toBe('2026<text>10<text>09')
    expect(maskSensitive('1、2、3')).toBe('1<text>2<text>3')
    expect(maskSensitive('100、200、300、400')).toBe('<phone>')
  })
})

describe('R4 N4 — err.name is bounded before it is masked', () => {
  it('no normalise call on the log line sees more than the bound', () => {
    const e = new Error('x')
    e.name = 'N'.repeat(1_000_000)
    const spy = jest.spyOn(String.prototype, 'normalize')
    try {
      describeUnknownThrow(e)
      const lens = spy.mock.contexts.map((c) => String(c).length)
      expect(Math.max(0, ...lens)).toBeLessThanOrEqual(2000)
    } finally {
      spy.mockRestore()
    }
  })
})
