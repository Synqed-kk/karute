// Greptile on #1159 (S114): G1 a labelled credential at a shape position,
// G2 a cut before the mask (the alarm hook's cuts, the pre-bound cut), G3 a
// decode before the length bound. Planted values are assembled at run time.
import type { ErrorEvent } from '@sentry/nextjs'
import {
  frameFile, masked, path, rebuildEnvelope, spaced, token, transactionName,
} from '@/lib/observability/sentry-exit'
import { scrubEvent } from '@/lib/observability/sentry-scrub'
import { describeUnknownThrow } from '@/lib/app-api/errors'
import { guardContent, preBound } from '@/lib/text/mask-sensitive'
import { KEY32, LABEL_FORMS, S2_CUT_SHAPES, residue } from './helpers/sentry-exit-plants'

const EID = 'a'.repeat(32)
const PW = ['Q7m', '!rT2'].join('')
const EMAIL = ['tanaka.hanako', 'example.com'].join('@')
const LOCAL_CUT = 'tanaka.ha'

describe('G1 — the labelled-credential rule at every guard position', () => {
  it('a user-agent holding password=… leaves no header through the transport', () => {
    const ev = { event_id: EID, request: { headers: { 'user-agent': `Mozilla/5.0 password=${PW}` } } }
    const s = JSON.stringify(rebuildEnvelope([{}, [[{ type: 'event' }, ev]]]))
    expect(s).not.toContain(PW)
  })

  it.each([
    ['token(200)', (v: string) => token(v, 200), `apikey:${PW.replace('!', 'x')}`],
    ['path(300)', (v: string) => path(v, 300), `/api/key=${PW.replace('!', 'x')}`],
    ['spaced(400)', (v: string) => spaced(v, 400), `curl secret: ${PW}`],
    ['transactionName', (v: string) => transactionName(v), `GET /a/token=${PW.replace('!', 'x')}`],
    ['frameFile', (v: string) => frameFile(v), `/x/password:${PW.replace('!', 'x')}.js`],
  ])('%s drops a labelled credential', (_n, fn, v) => {
    expect(fn(v)).toBeUndefined()
  })

  it('the text position still masks it (one rule, shared)', () => {
    expect(guardContent(`ua password=${PW}`)).not.toContain(PW)
    expect(masked(`failed password=${PW}`, 200)).toBe('failed <label>=<redacted>')
  })
})

describe('G2 — nothing is cut before it is masked', () => {
  it('the alarm hook then the exit: an email straddling 120 does not leave', () => {
    const msg = 'a '.repeat(55) + ' ' + EMAIL
    const hooked = scrubEvent({ type: undefined, event_id: EID, message: msg, tags: { alarm: '1' } } as ErrorEvent)
    const s = JSON.stringify(rebuildEnvelope([{}, [[{ type: 'event' }, hooked]]]))
    expect(s).not.toContain(LOCAL_CUT)
  })

  it('the alarm hook then the exit: a fingerprint straddling 100 does not leave', () => {
    const fp = 'a'.repeat(91) + EMAIL
    const hooked = scrubEvent({ type: undefined, event_id: EID, fingerprint: [fp], tags: { alarm: '1' } } as ErrorEvent)
    const s = JSON.stringify(rebuildEnvelope([{}, [[{ type: 'event' }, hooked]]]))
    expect(s).not.toContain(LOCAL_CUT)
  })

  it('the pre-bound cut with no whitespace: an email cut at 2000 does not leave', () => {
    const v = 'あ'.repeat(1991) + EMAIL
    expect(masked(v, 200) ?? '').not.toContain(LOCAL_CUT)
  })

  it('the pre-bound cut inside a spaced phone: no digit group of it leaves', () => {
    const phone = ['090', '1234', '5678'].join(' ')
    const v = 'あ'.repeat(1990) + ' ' + phone + ' tail'
    expect(v.slice(0, 2000).endsWith('090 1234 ')).toBe(true)
    const out = masked(v, 200) ?? ''
    expect(out).not.toContain('1234')
    expect(out).not.toContain('090')
  })

  it('a short text is not cut and keeps its last word', () => {
    expect(preBound('ok then 5')).toBe('ok then 5')
  })
})

describe('G3 — the length bound runs before any decode', () => {
  it('path and spaced never decode an oversized value', () => {
    const spy = jest.spyOn(globalThis, 'decodeURIComponent')
    try {
      const big = '/a%41'.repeat(1000)
      expect(path(big, 300)).toBeUndefined()
      expect(spaced('ua %41'.repeat(1000), 400)).toBeUndefined()
      expect(spy).not.toHaveBeenCalled()
      expect(path('/a%41', 300)).toBe('/a%41')
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('R-S114-12 — the server log line is masked before its newline cut', () => {
  // errors.ts is a log exit: the first-line cut must not leave a phone stub
  it('a phone split by a newline does not log its first groups', () => {
    const phone = ['090', '1234'].join(' ') + '\n' + '5678'
    const { errMessage } = describeUnknownThrow(new Error(`call ${phone} failed`))
    expect(errMessage).not.toContain('1234')
    expect(errMessage).not.toContain('090')
  })

  it('a labelled secret on the next line does not leave, and the first line is kept', () => {
    const { errMessage } = describeUnknownThrow(new Error(`login failed password:\n${PW}`))
    expect(errMessage).not.toContain(PW)
    expect(errMessage.startsWith('login failed')).toBe(true)
    expect(describeUnknownThrow(new Error('first   line\nsecond')).errMessage).toBe('first line')
  })
})

describe('R-S114-13 — the log line collapses whitespace before it masks', () => {
  it('a one-line phone with 4-space gaps logs no digit group', () => {
    const { errMessage } = describeUnknownThrow(new Error(['TEL 090', '1234', '5678'].join('    ')))
    for (const g of ['090', '1234', '5678']) expect(errMessage).not.toContain(g)
  })

  it('a phone split by four newlines does not log its first groups', () => {
    const { errMessage } = describeUnknownThrow(new Error(['090-1234', '5678'].join('\n\n\n\n')))
    expect(errMessage).not.toContain('090-1234')
    expect(errMessage).not.toContain('1234')
  })
})

const PW2 = ['Q7m', 'xrT2'].join('')

describe('R-S115-1 S1 — the widened label vocabulary, one rule at text and shape positions', () => {
  it.each(LABEL_FORMS.map((f) => [f(PW2)]))('%s: masked at text, dropped at spaced/token/path', (form) => {
    expect(masked(`failed ${form}`, 400) ?? '').not.toContain(PW2)
    expect(describeUnknownThrow(new Error(`failed ${form}`)).errMessage).not.toContain(PW2)
    expect(spaced(`Mozilla/5.0 ${form}`, 400) ?? '').not.toContain(PW2)
    expect(token(form.replace(/\s/g, ''), 200) ?? '').not.toContain(PW2)
    expect(path(`/api/${form.replace(/\s/g, '')}`, 300) ?? '').not.toContain(PW2)
  })

  it('keeps ordinary crash text that holds a label word without `:`/`=`', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KaruteShell/1'
    expect(spaced(ua, 400)).toBe(ua)
    expect(path('/api/auth/session/token', 300)).toBe('/api/auth/session/token')
    expect(masked('AuthSessionMissingError: Auth session missing!', 200)).toBe('AuthSessionMissingError: Auth session missing!')
    expect(masked('passthrough failed for pinned row', 200)).toBe('passthrough failed for pinned row')
  })
})

describe('R-S115-1 S2 — the pre-bound cut normalises before its tail scan', () => {
  it.each(S2_CUT_SHAPES)('%s cut at every offset after Japanese text leaves no letter or digit', (_n, shape) => {
    const leaks: string[] = []
    for (let k = 1965; k <= 1999; k++) {
      const v = 'あ'.repeat(k) + shape + 'ん'.repeat(60)
      const exit = residue(masked(v, 5000) ?? '')
      const log = residue(describeUnknownThrow(new Error(v)).errMessage)
      if (exit || log) leaks.push(`${k}:${exit}|${log}`)
    }
    expect(leaks).toEqual([])
  })

  it('a cut that splits an astral character drops the lone high surrogate', () => {
    const v = 'あ'.repeat(1999) + String.fromCodePoint(0x1d7ce) + 'ん'.repeat(10)
    expect(/[\uD800-\uDBFF]$/.test(preBound(v))).toBe(false)
  })
})

describe('R-S115-1 N2 — the cut strips a separate digit run, never the end of a kept word', () => {
  it('a 32-char key ending in a digit, kept whole before the cut word, stays masked on the log line', () => {
    expect(/\d$/.test(KEY32)).toBe(true)
    const v = 'あ'.repeat(1960) + ' ' + KEY32 + ' ' + 'z'.repeat(100)
    expect(describeUnknownThrow(new Error(v)).errMessage).not.toContain(KEY32.slice(8, 20))
    expect(preBound(v).endsWith(KEY32)).toBe(true)
  })

  it('a phone stub before the cut word is still dropped', () => {
    const v = 'あ'.repeat(1980) + ' 090 1234 ' + 'z'.repeat(100)
    expect(preBound(v)).toBe('あ'.repeat(1980))
  })
})
