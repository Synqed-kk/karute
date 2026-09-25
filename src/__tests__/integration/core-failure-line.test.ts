/**
 * coreFailureLine stays NARROW (Round 3 leg 7, fold F1): exactly two typed
 * synqed-core codes answer the failure line — `upstream_unavailable` (outage)
 * and `internal` (client defect) — with one bounded log carrying the code.
 * Everything else is null and logs nothing, so a widening to any other code,
 * a plain Error, or a look-alike object can never ship green.
 */
// The REAL ja dictionary behind getTranslations (the helper imports it lazily).
jest.mock('next-intl/server', () => {
  const ja = jest.requireActual<Record<string, Record<string, unknown>>>('../../../messages/ja.json')
  return { getTranslations: jest.fn(async (ns: string) => (key: string) => ja[ns]?.[key]) }
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppApiError, type AppApiErrorCode } from '@/lib/app-api/errors'
import { coreFailureLine } from '@/lib/auth/core-failure-line'

const JA = JSON.parse(readFileSync(join(process.cwd(), 'messages', 'ja.json'), 'utf8'))
const FAILURE_LINE: string = JA.common.somethingWentWrong

// Every AppApiErrorCode, typed exhaustively: a new code fails tsc until it is
// placed here, and only the two `true` rows may answer the line.
const ANSWERS_THE_LINE: Record<AppApiErrorCode, boolean> = {
  upstream_unavailable: true,
  internal: true,
  validation: false,
  unauthenticated: false,
  revoked: false,
  forbidden: false,
  tenant_forbidden: false,
  store_forbidden: false,
  store_unassigned: false,
  membership_inactive: false,
  not_found: false,
  no_audio: false,
  conflict: false,
  not_returning: false,
  rate_limited: false,
  not_implemented: false,
  jwks_unavailable: false,
  config: false,
}
const CODES = Object.keys(ANSWERS_THE_LINE) as AppApiErrorCode[]
const STATUS = { upstream_unavailable: 502, internal: 500 } as const

let consoleError: jest.SpyInstance
beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => consoleError.mockRestore())

describe('the two typed synqed-core codes answer the line, one log carrying the code', () => {
  it.each(['upstream_unavailable', 'internal'] as const)('AppApiError(%s)', async (code) => {
    expect(await coreFailureLine(new AppApiError(code, 'x'), '[t]')).toBe(FAILURE_LINE)
    expect(FAILURE_LINE).toBe('エラーが発生しました。')
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0]).toEqual([
      `[t] pre-core read failed (${code}):`,
      { errName: 'AppApiError', errStatus: STATUS[code], errMessage: 'x' },
    ])
  })
})

describe('every other AppApiError code → null, no log', () => {
  it.each(CODES.filter((c) => !ANSWERS_THE_LINE[c]))('AppApiError(%s)', async (code) => {
    expect(await coreFailureLine(new AppApiError(code, 'x'), '[t]')).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('anything that is not an AppApiError → null, no log', () => {
  it.each([
    ['the gate\'s plain-Error denial', new Error('You do not have permission to perform this action.')],
    ['a look-alike object carrying the outage code', { code: 'upstream_unavailable', message: 'x' }],
    ['the bare string', 'upstream_unavailable'],
    ['undefined', undefined],
    ['null', null],
  ])('%s', async (_label, thrown) => {
    expect(await coreFailureLine(thrown, '[t]')).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
  })
})
