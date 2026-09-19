// Error contract (packet 03 point 5). The load-bearing row is
// jwks_unavailable → 503 (an upstream outage is NOT a 401 about the token).
import { AppApiError, toAppApiError, errorBody, describeUnknownThrow } from '@/lib/app-api/errors'
import { BearerVerifyError } from '@/lib/auth/verify-bearer'
import { RevocationError } from '@/lib/auth/revocation'

describe('facade error contract', () => {
  it('maps jwks_unavailable → 503, never 401', () => {
    const err = toAppApiError(new BearerVerifyError('jwks_unavailable', 'JWKS down'))
    expect(err.code).toBe('jwks_unavailable')
    expect(err.status).toBe(503)
  })

  it('maps token-statement verifier failures → 401', () => {
    for (const code of ['expired', 'signature', 'issuer', 'audience', 'malformed', 'unsupported_alg'] as const) {
      const err = toAppApiError(new BearerVerifyError(code, code))
      expect(err.status).toBe(401)
      expect(err.code).toBe('unauthenticated')
    }
  })

  it('maps a revoked token → 401 revoked', () => {
    const err = toAppApiError(new RevocationError('revoked'))
    expect(err.code).toBe('revoked')
    expect(err.status).toBe(401)
  })

  it('maps verifier config error → 500 config', () => {
    expect(toAppApiError(new BearerVerifyError('config', 'no url')).status).toBe(500)
  })

  it('never leaks an unknown throw — internal 500, generic message', () => {
    const err = toAppApiError(new Error('secret stack frame /etc/passwd'))
    expect(err.code).toBe('internal')
    expect(err.status).toBe(500)
    expect(err.message).toBe('Internal error')
  })

  it('status table covers every classified code', () => {
    const cases: [AppApiError['code'], number][] = [
      ['validation', 400], ['unauthenticated', 401], ['revoked', 401], ['forbidden', 403],
      ['tenant_forbidden', 403], ['store_forbidden', 403], ['membership_inactive', 403],
      ['not_found', 404], ['no_audio', 404], ['conflict', 409], ['not_returning', 422],
      ['rate_limited', 429], ['not_implemented', 501], ['jwks_unavailable', 503],
      ['upstream_unavailable', 502], ['config', 500], ['internal', 500],
    ]
    for (const [code, status] of cases) {
      expect(new AppApiError(code, 'x').status).toBe(status)
    }
  })

  it('error body is a stable {error:{code,message}} shape', () => {
    const body = errorBody(new AppApiError('conflict', 'stale', { currentVersion: 'v2' }))
    expect(body).toEqual({ error: { code: 'conflict', message: 'stale', currentVersion: 'v2' } })
  })
})

// PKT-A: an unclassified throw keeps its reason, for the server log ONLY —
// never the client body. incident-recording-fallback-20260918.
describe('unknown-throw reason (server log only, client body untouched)', () => {
  it('toAppApiError keeps the original value as a non-enumerable cause; describeUnknownThrow reads it', () => {
    const err = toAppApiError(new Error('boom'))
    expect(errorBody(err)).toEqual({ error: { code: 'internal', message: 'Internal error' } })
    expect(describeUnknownThrow(err.cause)).toEqual({ errName: 'Error', errMessage: 'boom' })
  })

  it('the cause never appears in JSON.stringify(err) nor in errorBody(err)', () => {
    const err = toAppApiError(new Error('boom'))
    expect(Object.keys(JSON.parse(JSON.stringify(err)))).not.toContain('cause')
    expect(Object.keys(errorBody(err).error)).not.toContain('cause')
  })

  it('a DeepgramHttpError-shaped throw (an Error with a numeric status) surfaces errStatus', () => {
    const deepgramLike = Object.assign(new Error('Deepgram 400 Bad Request'), { name: 'DeepgramHttpError', status: 400 })
    const err = toAppApiError(deepgramLike)
    expect(describeUnknownThrow(err.cause)).toEqual({ errName: 'DeepgramHttpError', errStatus: 400, errMessage: 'Deepgram 400 Bad Request' })
  })

  it('a thrown non-Error does not throw inside the helper', () => {
    expect(() => describeUnknownThrow('str')).not.toThrow()
    expect(() => describeUnknownThrow({ a: 1 })).not.toThrow()
    expect(() => describeUnknownThrow(null)).not.toThrow()
    expect(describeUnknownThrow('str')).toEqual({ errName: 'string', errMessage: 'str' })
    expect(describeUnknownThrow(null)).toEqual({ errName: 'object', errMessage: 'null' })
  })

  describe('masking table', () => {
    it('masks an email', () => {
      expect(describeUnknownThrow(new Error('contact liam@example.com for help')).errMessage).toBe('contact <email> for help')
    })

    it('masks a signed URL — query gone (the token), origin+path kept', () => {
      const msg = 'deepgram said no https://x.supabase.co/storage/v1/object/sign/recordings/a.webm?token=SECRET'
      const { errMessage } = describeUnknownThrow(new Error(msg))
      expect(errMessage).toBe('deepgram said no https://x.supabase.co/storage/v1/object/sign/recordings/a.webm')
      expect(errMessage).not.toContain('SECRET')
    })

    it('masks a JWT-shaped token', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdHNpZ25hdHVyZQ'
      expect(describeUnknownThrow(new Error(`bad token ${jwt}`)).errMessage).toBe('bad token <jwt>')
    })

    it('masks a run of 7+ digits (phone/card-like)', () => {
      expect(describeUnknownThrow(new Error('card 12345678901 declined')).errMessage).toBe('card <digits> declined')
    })

    it('caps a long message at 200 chars, appending an ellipsis when cut', () => {
      const long = 'x'.repeat(300)
      const { errMessage } = describeUnknownThrow(new Error(long))
      expect(errMessage).toBe(`${'x'.repeat(200)}…`)
    })

    // Fix round 1 (2026-09-19, lead line-read of 01037d53a): masking must run
    // BEFORE the 200-char cap — a secret split by the cap stops matching its
    // pattern and leaks a fragment.
    it('masks an email that would otherwise be split by the 200-char cap', () => {
      const msg = `${'x'.repeat(190)}user@example.com and more`
      const { errMessage } = describeUnknownThrow(new Error(msg))
      expect(errMessage).not.toContain('@')
    })

    it('masks a JWT that would otherwise be split by the 200-char cap', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdHNpZ25hdHVyZQ'
      // A single separator (not filler 'x's) so the \b before 'eyJ' still
      // matches — the mask must see the JWT intact, that's the point of the test.
      const msg = `${'x'.repeat(150)} ${jwt}`
      const { errMessage } = describeUnknownThrow(new Error(msg))
      expect(errMessage).not.toContain('eyJ')
    })

    it('masks a signed-URL token that would otherwise be split by the 200-char cap', () => {
      const msg = `${'x'.repeat(180)}https://x.supabase.co/storage/v1/object/sign/recordings/a.webm?token=SECRETTOKEN`
      const { errMessage } = describeUnknownThrow(new Error(msg))
      expect(errMessage).not.toContain('SECRET')
      expect(errMessage).not.toContain('token=')
    })

    it('keeps only the first line of a multi-line message', () => {
      expect(describeUnknownThrow(new Error('first line\nsecond line with secrets')).errMessage).toBe('first line')
    })
  })
})
