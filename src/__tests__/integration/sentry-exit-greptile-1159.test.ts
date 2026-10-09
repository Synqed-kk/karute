// Greptile on #1159 (S114): G1 a labelled credential at a shape position,
// G2 a cut before the mask (the alarm hook's cuts, the pre-bound cut), G3 a
// decode before the length bound. Planted values are assembled at run time.
import type { ErrorEvent } from '@sentry/nextjs'
import {
  frameFile, masked, path, rebuildEnvelope, spaced, token, transactionName,
} from '@/lib/observability/sentry-exit'
import { scrubEvent } from '@/lib/observability/sentry-scrub'
import { guardContent, preBound } from '@/lib/text/mask-sensitive'

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
