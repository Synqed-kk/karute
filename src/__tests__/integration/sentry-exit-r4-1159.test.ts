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
