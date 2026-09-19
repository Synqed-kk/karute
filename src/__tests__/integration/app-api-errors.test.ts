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

  // PKT-A round 4: `Number.isFinite` already guards this (existing code), not
  // just `typeof === 'number'` — NaN/Infinity are numbers but not a real HTTP
  // status, and must not surface as one.
  it('a non-finite status (NaN/Infinity) never surfaces as errStatus', () => {
    expect(describeUnknownThrow(Object.assign(new Error('x'), { status: NaN }))).not.toHaveProperty('errStatus')
    expect(describeUnknownThrow(Object.assign(new Error('x'), { status: Infinity }))).not.toHaveProperty('errStatus')
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
      // Space-separated words (fix round 2: a single unbroken run this long
      // would now hit the new blob rule below — see its own describe block).
      const long = Array(60).fill('word').join(' ')
      const { errMessage } = describeUnknownThrow(new Error(long))
      expect(errMessage).toBe(`${long.slice(0, 200)}…`)
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

    // Fix round 2 SHOULD: a bare CR (no LF) used to survive line-extraction
    // and then get flattened to a space by the whitespace-collapse, leaking
    // whatever followed it.
    it('a bare CR is ALSO a line boundary, not just LF', () => {
      expect(describeUnknownThrow(new Error('public\rsecret')).errMessage).toBe('public')
    })

    it('masks the value after Bearer (case-insensitive)', () => {
      const { errMessage } = describeUnknownThrow(new Error('auth failed, bearer abc123secretvalue'))
      expect(errMessage).toBe('auth failed, Bearer <token>')
      expect(errMessage).not.toContain('secretvalue')
    })

    it('masks a labelled credential (token/apikey/api_key/key/secret/password/authorization = value)', () => {
      const { errMessage } = describeUnknownThrow(new Error('request failed with api_key=sk-live-1234567890abcdef'))
      expect(errMessage).toBe('request failed with <label>=<redacted>')
      expect(errMessage).not.toContain('sk-live')
    })

    // Fix round 3: the labelled-credential pattern used to start with `\b`,
    // and `_` is a word character (no boundary before it) while camelCase has
    // no boundary at all — so the commonest real credential label shapes
    // (access_token, client_secret, accessToken, clientSecret, …) passed
    // through unmasked.
    it.each([
      ['access_token=abc123short', 'abc123short'],
      ['client_secret: hunter2', 'hunter2'],
      ['refresh_token=xyz', 'xyz'],
      ['db_password=pw1', 'pw1'],
      ['accessToken=abc999', 'abc999'],
      ['clientSecret=abc999', 'abc999'],
    ])('masks a prefixed/camelCase credential label: %s', (input, value) => {
      const { errMessage } = describeUnknownThrow(new Error(input))
      expect(errMessage).not.toContain(value)
      expect(errMessage).toContain('<label>=<redacted>')
    })

    it('masks a labelled credential embedded inside a URL PATH — the URL step above only strips the query', () => {
      const { errMessage } = describeUnknownThrow(new Error('GET https://x.test/key=secret failed'))
      expect(errMessage).toBe('GET https://x.test/<label>=<redacted> failed')
      expect(errMessage).not.toContain('secret')
    })

    it('URL masking is case-insensitive — an uppercase scheme used to survive', () => {
      // The query key ("sig", not a label word) is chosen so ONLY the URL
      // rule's query-stripping can hide the value — the labelled-credential
      // rule (a different, independent mask) must not also happen to catch
      // it, or this test would stay green under a broken URL rule too.
      const { errMessage } = describeUnknownThrow(new Error('HTTPS://x.test/a?sig=SECRETVALUE'))
      expect(errMessage).not.toContain('SECRETVALUE')
    })

    it('masks an opaque 32+-char blob (base64 / API key)', () => {
      const blob = 'A'.repeat(40)
      const { errMessage } = describeUnknownThrow(new Error(`session data ${blob} expired`))
      expect(errMessage).toBe('session data <blob> expired')
    })

    it('a canonical UUID survives the blob rule', () => {
      const uuid = '3fa1c2e4-5b6c-4d7e-8f9a-1a2b3c4d5e6f'
      expect(describeUnknownThrow(new Error(`customer ${uuid} not found`)).errMessage).toBe(`customer ${uuid} not found`)
    })

    // PKT-A round 4, point 1: a storage key BUILT from ids (not just a bare
    // UUID) must survive whole — it names WHICH object is lost.
    it('a storage key built from ids survives the blob rule whole', () => {
      const msg =
        'Audio not readable at app_3fa1c2e4-5b6c-4d7e-8f9a-1a2b3c4d5e6f_0f8c6c9a-3f2d-4a71-9b5e-7a1b2c3d4e5f.webm: Object not found'
      expect(describeUnknownThrow(new Error(msg)).errMessage).toBe(msg)
    })

    it('masks exactly 7 digits; 6 digits are left alone', () => {
      expect(describeUnknownThrow(new Error('code 1234567 here')).errMessage).toBe('code <digits> here')
      expect(describeUnknownThrow(new Error('code 123456 here')).errMessage).toBe('code 123456 here')
    })

    // PKT-A round 4, point 2: non-ASCII free text (a customer name in an
    // upstream message) never reaches the log.
    it('masks non-ASCII free text', () => {
      const { errMessage } = describeUnknownThrow(new Error('customer update failed: 田中 美咲 already has an open karute'))
      expect(errMessage).toContain('<text>')
      expect(/[^\x00-\x7F]/.test(errMessage)).toBe(false)
      expect(errMessage).toContain('customer update failed:')
      expect(errMessage).toContain('already has an open karute')
    })

    // PKT-A round 4, point 3: hyphenated JP phone numbers.
    it('masks a hyphenated phone number', () => {
      expect(describeUnknownThrow(new Error('phone 090-1234-5678 already registered')).errMessage).toBe(
        'phone <phone> already registered',
      )
    })

    it('masks a hyphenated phone number with a 2-digit area code too', () => {
      const { errMessage } = describeUnknownThrow(new Error('03-1234-5678'))
      expect(errMessage).toBe('<phone>')
    })

    it('does not mask a hyphenated digit run with no leading 0', () => {
      expect(describeUnknownThrow(new Error('error code 12-34-567')).errMessage).toBe('error code 12-34-567')
    })
  })

  describe('errName is masked and bounded (fix round 2)', () => {
    it('a leaked secret in .name is masked the same way as the message', () => {
      const hostile = Object.assign(new Error('safe message'), { name: 'Bearer secret-token-value' })
      expect(describeUnknownThrow(hostile).errName).toBe('Bearer <token>')
    })

    it('caps errName at 60 chars', () => {
      // Space-separated (not one long run — that would hit the blob rule
      // before the cap even applies, same interaction as the message cap test).
      const longName = Array(20).fill('Name').join(' ')
      const hostile = Object.assign(new Error('safe'), { name: longName })
      expect(describeUnknownThrow(hostile).errName).toBe(`${longName.slice(0, 60)}…`)
    })
  })

  // Fix round 2, MUST-1a: a hostile thrown shape can never make this helper
  // throw — it degrades to the total fallback instead.
  describe('total safety — hostile thrown shapes never throw', () => {
    it('a throwing message getter does not throw', () => {
      const hostile = new Error('placeholder')
      Object.defineProperty(hostile, 'message', { get() { throw new Error('boom') } })
      expect(() => describeUnknownThrow(hostile)).not.toThrow()
      expect(describeUnknownThrow(hostile)).toEqual({ errName: 'unformattable', errMessage: '' })
    })

    it('a throwing toString does not throw', () => {
      const hostile = { toString() { throw new Error('boom') } }
      expect(() => describeUnknownThrow(hostile)).not.toThrow()
      expect(describeUnknownThrow(hostile)).toEqual({ errName: 'unformattable', errMessage: '' })
    })

    it('a throwing status getter does not throw', () => {
      const hostile = new Error('fine message')
      Object.defineProperty(hostile, 'status', { get() { throw new Error('boom') } })
      expect(() => describeUnknownThrow(hostile)).not.toThrow()
      expect(describeUnknownThrow(hostile)).toEqual({ errName: 'unformattable', errMessage: '' })
    })

    it('a BigInt name does not throw, and never reaches JSON.stringify as a BigInt', () => {
      const hostile = Object.assign(new Error('fine message'), { name: BigInt(1) as unknown as string })
      expect(() => describeUnknownThrow(hostile)).not.toThrow()
      const result = describeUnknownThrow(hostile)
      expect(typeof result.errName).toBe('string')
      expect(() => JSON.stringify(result)).not.toThrow()
    })
  })

  // Fix round 2, MUST-2: a huge thrown message must format fast regardless of
  // input size — the OLD email pattern took >1.5s on a 1 MiB pathological
  // input (quadratic rescans). Bounded now two ways: `preBound` caps input to
  // 2000 chars before any mask regex runs, AND the email pattern itself uses
  // bounded quantifiers.
  describe('perf — bounded regardless of input size', () => {
    it('a 1 MiB single-token message formats in well under 100ms', () => {
      const huge = new Error('a'.repeat(1024 * 1024))
      const start = performance.now()
      describeUnknownThrow(huge)
      expect(performance.now() - start).toBeLessThan(100)
    })

    it('a 1 MiB "a@"-heavy message (pathological for a naive email regex) formats in well under 100ms', () => {
      const huge = new Error('a@'.repeat(512 * 1024))
      const start = performance.now()
      describeUnknownThrow(huge)
      expect(performance.now() - start).toBeLessThan(100)
    })
  })
})
