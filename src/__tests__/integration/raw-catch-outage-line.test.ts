/**
 * A synqed-core OUTAGE inside a WRITE catch answers the failure line (S33, Round 3 —
 * the raw-English-line class, leg 1; D-S33-1/2).
 *
 * coreFailureLine answers only a TYPED AppApiError. A direct SDK call never throws one:
 * a non-2xx is the SDK's own SynqedError (`status` + core's own text), a network drop a
 * native TypeError ('fetch failed'). classifyCoreThrow maps exactly those two outage
 * shapes onto the typed class; everything else comes back as the same value
 * (lesson 95: a shared discriminator gets its own pin).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppApiError } from '@/lib/app-api/errors'
import { classifyCoreThrow } from '@/lib/auth/core-failure-line'
import { STORE_SCOPE_UNVERIFIED } from '@/lib/auth/store-lock'

const DENIAL = 'You do not have permission to perform this action.'

/** The SDK's own class, byte-for-byte (node_modules/@synqed-kk/client/dist/client.js:145-151). */
class SynqedError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'SynqedError'
  }
}

describe('classifyCoreThrow — maps ONLY the two SDK outage shapes onto the typed class', () => {
  const outage = (e: unknown, message: string) => {
    const out = classifyCoreThrow(e)
    expect(out).toBeInstanceOf(AppApiError)
    expect(out).toMatchObject({ name: 'AppApiError', code: 'upstream_unavailable', status: 502, message })
    // The original rides `cause` (non-enumerable, never on the wire).
    expect((out as Error).cause).toBe(e)
  }

  it('a network drop (TypeError) → upstream_unavailable, the original on cause', () => {
    outage(new TypeError('fetch failed'), 'synqed-core call failed (TypeError): fetch failed')
  })

  it.each([500, 502, 503])('an SDK %i → upstream_unavailable, the status + core text in the message', (status) => {
    outage(new SynqedError(status, 'synqed-core: down'), `synqed-core call failed (SynqedError ${status}): synqed-core: down`)
  })

  it.each([400, 403, 404, 409, 499])('an SDK %i is core\'s own refusal → the SAME object back', (status) => {
    const e = new SynqedError(status, 'refused')
    expect(classifyCoreThrow(e)).toBe(e)
  })

  it.each([
    ['a plain-Error denial', new Error(DENIAL)],
    ['an AppApiError internal (status 500 — not an SDK error)', new AppApiError('internal', 'synqed-core client unavailable')],
    ['an AppApiError upstream_unavailable', new AppApiError('upstream_unavailable', 'synqed-core roster fetch failed')],
    ['an AppApiError store_forbidden', new AppApiError('store_forbidden', STORE_SCOPE_UNVERIFIED)],
    ['an AppApiError not_found', new AppApiError('not_found', 'karute record not found')],
    ['an Error named SynqedError with a non-numeric status', Object.assign(new SynqedError(503, 'x'), { status: '503' })],
    ['a plain object shaped like an SDK error', { name: 'SynqedError', status: 503, message: 'x' }],
    ['a string', 'fetch failed'],
    ['null', null],
    ['undefined', undefined],
  ])('%s → the SAME value back', (_label, e) => {
    expect(classifyCoreThrow(e)).toBe(e)
  })

  it('the SDK still names its error class the way the classifier recognises it', () => {
    const sdk = readFileSync(join(process.cwd(), 'node_modules', '@synqed-kk', 'client', 'dist', 'client.js'), 'utf8')
    expect(sdk).toContain("this.name = 'SynqedError';")
    expect(sdk).toContain('this.status = status;')
    expect(sdk).toContain('throw new SynqedError(res.status,')
  })
})
