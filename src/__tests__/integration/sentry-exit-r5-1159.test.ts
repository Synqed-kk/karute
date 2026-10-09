// #1159 fix round 5 (R-S115-15, the final round): the Opus attack and the
// Sonnet read of round 4. Planted values are assembled at run time from parts.
import { masked, rebuildEnvelope } from '@/lib/observability/sentry-exit'
import { describeUnknownThrow } from '@/lib/app-api/errors'
import { decodeText, preBound } from '@/lib/text/mask-sensitive'

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
})
