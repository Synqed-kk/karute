// ONE masking home (item 102, R-S112-5 F8 / R-S112-6 S3): preBound and the
// masked pipeline live only in mask-sensitive.ts; errors.ts and the Sentry exit
// both call that one module's functions.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.mock('@/lib/text/mask-sensitive', () => {
  const actual = jest.requireActual('@/lib/text/mask-sensitive')
  return { ...actual, preBound: jest.fn(actual.preBound), maskSensitive: jest.fn(actual.maskSensitive) }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const home = require('@/lib/text/mask-sensitive') as typeof import('@/lib/text/mask-sensitive')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const exit = require('@/lib/observability/sentry-exit') as typeof import('@/lib/observability/sentry-exit')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const errors = require('@/lib/app-api/errors') as typeof import('@/lib/app-api/errors')

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('one masking home', () => {
  beforeEach(() => jest.clearAllMocks())

  it("the exit's masked IS mask-sensitive's masked (same function object)", () => {
    expect(exit.masked).toBe(home.masked)
  })

  it('errors.ts calls the one preBound and the one maskSensitive (imported, not copied)', () => {
    const preBound = home.preBound as unknown as jest.Mock
    const mask = home.maskSensitive as unknown as jest.Mock
    errors.describeUnknownThrow(new Error('a'.repeat(2500)))
    // err.name (R-S115-10 N4) and the message, each through the one preBound
    // (R-S115-15: the pin names WHAT each call bounds, not only how many)
    expect(preBound.mock.calls.map((c) => c[0])).toEqual(['Error', 'a'.repeat(2500)])
    expect(mask).toHaveBeenCalled()
    // the exit's masked is the home's own function (identity above), whose
    // body calls the home's preBound and maskSensitive directly
    expect(exit.masked('b '.repeat(1500), 5000)?.length).toBeLessThanOrEqual(2000)
  })

  it('no second definition of preBound or the masked pipeline anywhere in src/lib', () => {
    for (const f of ['src/lib/app-api/errors.ts', 'src/lib/observability/sentry-exit.ts', 'src/lib/observability/sentry-scrub.ts']) {
      const src = read(f)
      expect(src).not.toMatch(/function\s+preBound\b/)
      expect(src).not.toMatch(/function\s+masked\b/)
      expect(src).not.toMatch(/function\s+maskSensitive\b/)
    }
    expect(read('src/lib/text/mask-sensitive.ts')).toMatch(/export function preBound\b/)
  })

  it("errors.ts's observable behaviour: bound, first line, whitespace collapse, 200 cap", () => {
    const actual = jest.requireActual('@/lib/text/mask-sensitive') as typeof home
    const long = `${'word '.repeat(450)}TAIL`
    expect(actual.preBound(long).length).toBeLessThanOrEqual(2000)
    expect(actual.preBound(long).endsWith('word')).toBe(true)
    // Greptile #1159 G2: a cut word is dropped, never kept half (no whitespace
    // and all ASCII → nothing is left)
    expect(actual.preBound('x'.repeat(2500))).toBe('')
    const out = errors.describeUnknownThrow(new Error('first   line\nsecond'))
    expect(out.errMessage).toBe('first line')
    expect(errors.describeUnknownThrow(new Error('z '.repeat(300))).errMessage.endsWith('…')).toBe(true)
  })
})
