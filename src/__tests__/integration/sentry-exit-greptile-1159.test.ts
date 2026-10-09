// Greptile on #1159 (S114): G1 a labelled credential at a shape position,
// G2 a cut before the mask (the alarm hook's cuts, the pre-bound cut), G3 a
// decode before the length bound. Planted values are assembled at run time.
/* eslint-disable @typescript-eslint/no-explicit-any -- deep reads of rebuilt output */
import {
  frameFile, masked, path, rebuildEnvelope, spaced, token, transactionName,
} from '@/lib/observability/sentry-exit'
import { guardContent } from '@/lib/text/mask-sensitive'

const EID = 'a'.repeat(32)
const PW = ['Q7m', '!rT2'].join('')

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
