/**
 * Bearer verifier test matrix (PLAN §4, packet-01 point 4). Runs as an
 * assert-style matrix — every row is a security requirement the facade depends
 * on. HS256 is today's live setup (node:crypto, in-process); the asymmetric
 * ES256/JWKS row exercises the real jose remote-JWKS code path against a locally
 * generated keypair (no live asymmetric project needed).
 *
 *   valid | wrong-issuer | wrong-audience | expired | tampered | alg-not-allowed
 *   + ES256 via JWKS (key-rotation path) + env-derived config (no hardcoded project)
 */
import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import {
  verifyBearer,
  verifierConfigFromEnv,
  BearerVerifyError,
  _resetJwksCache,
  type VerifierConfig,
} from '@/lib/auth/verify-bearer'

const SECRET = 'test-jwt-secret-do-not-use-in-prod'
const ISSUER = 'https://testproj.supabase.co/auth/v1'
const AUD = 'authenticated'

const HS_CONFIG: VerifierConfig = {
  issuer: ISSUER,
  audience: AUD,
  hs256Secret: SECRET,
  algorithms: ['HS256'],
}

const now = () => Math.floor(Date.now() / 1000)
const b64 = (obj: unknown) =>
  Buffer.from(JSON.stringify(obj)).toString('base64url')

function makeHs256(
  claims: Record<string, unknown>,
  { secret = SECRET, alg = 'HS256' } = {},
): string {
  const header = b64({ alg, typ: 'JWT' })
  const payload = b64(claims)
  const sig = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${sig}`
}

const validClaims = () => ({
  sub: 'user-uuid-123',
  iss: ISSUER,
  aud: AUD,
  exp: now() + 3600,
  iat: now(),
  role: 'authenticated',
})

/** Assert a verifyBearer call rejects with the expected BearerVerifyError code. */
async function expectReject(token: string, config: VerifierConfig, code: string) {
  await expect(verifyBearer(token, config)).rejects.toMatchObject({
    name: 'BearerVerifyError',
    code,
  })
}

describe('verifyBearer — HS256 matrix (today live path)', () => {
  it('valid current-project token → resolves with claims', async () => {
    const claims = await verifyBearer(makeHs256(validClaims()), HS_CONFIG)
    expect(claims.sub).toBe('user-uuid-123')
    expect(claims.iss).toBe(ISSUER)
  })

  it('wrong issuer → rejected (issuer)', async () => {
    const t = makeHs256({ ...validClaims(), iss: 'https://evil.supabase.co/auth/v1' })
    await expectReject(t, HS_CONFIG, 'issuer')
  })

  it('wrong audience → rejected (audience)', async () => {
    const t = makeHs256({ ...validClaims(), aud: 'anon' })
    await expectReject(t, HS_CONFIG, 'audience')
  })

  it('expired token → rejected (expired)', async () => {
    const t = makeHs256({ ...validClaims(), exp: now() - 10 })
    await expectReject(t, HS_CONFIG, 'expired')
  })

  it('tampered signature → rejected (signature)', async () => {
    const good = makeHs256(validClaims())
    const [h, p] = good.split('.')
    const forged = createHmac('sha256', 'a-different-secret')
      .update(`${h}.${p}`)
      .digest('base64url')
    await expectReject(`${h}.${p}.${forged}`, HS_CONFIG, 'signature')
  })

  it('tampered payload (re-encoded, old sig) → rejected (signature)', async () => {
    const good = makeHs256(validClaims())
    const [h, , sig] = good.split('.')
    const swapped = b64({ ...validClaims(), sub: 'attacker-uuid' })
    await expectReject(`${h}.${swapped}.${sig}`, HS_CONFIG, 'signature')
  })

  it('alg "none" → rejected (unsupported_alg)', async () => {
    const header = b64({ alg: 'none', typ: 'JWT' })
    const payload = b64(validClaims())
    await expectReject(`${header}.${payload}.`, HS_CONFIG, 'unsupported_alg')
  })

  it('alg outside allow-list (RS256 claimed) → rejected (unsupported_alg)', async () => {
    const t = makeHs256(validClaims(), { alg: 'RS256' })
    await expectReject(t, HS_CONFIG, 'unsupported_alg')
  })

  it('nbf in the future → rejected (not_yet_valid)', async () => {
    const t = makeHs256({ ...validClaims(), nbf: now() + 600 })
    await expectReject(t, HS_CONFIG, 'not_yet_valid')
  })

  it('malformed (2 segments) → rejected (malformed)', async () => {
    await expectReject('aaa.bbb', HS_CONFIG, 'malformed')
  })

  it('HS256 token but no secret configured → rejected (config)', async () => {
    await expectReject(makeHs256(validClaims()), {
      issuer: ISSUER,
      audience: AUD,
      algorithms: ['HS256'],
    }, 'config')
  })
})

describe('verifyBearer — asymmetric ES256 via JWKS (key-rotation path)', () => {
  const JWKS_URI = 'https://testproj.supabase.co/auth/v1/.well-known/jwks.json'

  beforeEach(() => _resetJwksCache())

  /** Mint an ES256 JWS with node:crypto (raw P1363 sig, JWS-native). */
  function makeEs256(claims: Record<string, unknown>, kid: string) {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' }
    const header = b64({ alg: 'ES256', typ: 'JWT', kid })
    const payload = b64(claims)
    const sig = cryptoSign('sha256', Buffer.from(`${header}.${payload}`), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url')
    return { token: `${header}.${payload}.${sig}`, jwk }
  }

  const jwksFetchOf = (...jwks: object[]) =>
    jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ keys: jwks }) }))

  it('valid ES256 token verified against a served JWKS', async () => {
    const { token, jwk } = makeEs256(validClaims(), 'kid-1')
    const claims = await verifyBearer(token, {
      issuer: ISSUER, audience: AUD, jwksUri: JWKS_URI, algorithms: ['ES256'],
      jwksFetch: jwksFetchOf(jwk),
    })
    expect(claims.sub).toBe('user-uuid-123')
  })

  it('ES256 signed by a DIFFERENT key → rejected (signature)', async () => {
    const { token } = makeEs256(validClaims(), 'kid-1')
    const { jwk: wrongJwk } = makeEs256(validClaims(), 'kid-1') // different keypair, same kid
    await expectReject(
      token,
      { issuer: ISSUER, audience: AUD, jwksUri: JWKS_URI, algorithms: ['ES256'], jwksFetch: jwksFetchOf(wrongJwk) },
      'signature',
    )
  })

  it('unknown kid → refetch (rotation), then no matching key → rejected', async () => {
    const { token } = makeEs256(validClaims(), 'rotated-kid')
    const fetchImpl = jwksFetchOf({ kid: 'old-kid', kty: 'EC' }) // JWKS lacks the token kid
    await expectReject(
      token,
      { issuer: ISSUER, audience: AUD, jwksUri: JWKS_URI, algorithms: ['ES256'], jwksFetch: fetchImpl },
      'signature',
    )
    expect(fetchImpl).toHaveBeenCalled() // proves it fetched on the unknown kid
  })

  const esConfig = (fetchImpl: unknown): VerifierConfig => ({
    issuer: ISSUER, audience: AUD, jwksUri: JWKS_URI, algorithms: ['ES256'],
    jwksFetch: fetchImpl as VerifierConfig['jwksFetch'],
  })

  it('JWKS fetch rejects (network) → rejected (jwks_unavailable), never a native error', async () => {
    const { token } = makeEs256(validClaims(), 'kid-1')
    const fetchImpl = jest.fn(async () => { throw new Error('ECONNREFUSED') })
    await expectReject(token, esConfig(fetchImpl), 'jwks_unavailable')
  })

  it('JWKS non-200 → rejected (jwks_unavailable)', async () => {
    const { token } = makeEs256(validClaims(), 'kid-1')
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    await expectReject(token, esConfig(fetchImpl), 'jwks_unavailable')
  })

  it('JWKS body is not JSON → rejected (jwks_unavailable)', async () => {
    const { token } = makeEs256(validClaims(), 'kid-1')
    const fetchImpl = jest.fn(async () => ({
      ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') },
    }))
    await expectReject(token, esConfig(fetchImpl), 'jwks_unavailable')
  })

  it('JWKS serves an unusable key for the kid → rejected (jwks_unavailable)', async () => {
    const { token } = makeEs256(validClaims(), 'kid-1')
    // matching kid, garbage key material — createPublicKey cannot import it
    const fetchImpl = jwksFetchOf({ kid: 'kid-1', kty: 'EC', x: '!!', y: '!!', crv: 'P-256' })
    await expectReject(token, esConfig(fetchImpl), 'jwks_unavailable')
  })

  it('kid-miss inside the cooldown window → NO second upstream fetch', async () => {
    const { token: t1 } = makeEs256(validClaims(), 'unknown-a')
    const { token: t2 } = makeEs256(validClaims(), 'unknown-b')
    const fetchImpl = jwksFetchOf({ kid: 'real-kid', kty: 'EC' })
    await expectReject(t1, esConfig(fetchImpl), 'signature') // fetches, caches
    await expectReject(t2, esConfig(fetchImpl), 'signature') // cooldown: no refetch
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('cache older than the TTL → refetched even on a kid hit (removed key stops verifying)', async () => {
    jest.useFakeTimers({ doNotFake: ['performance'] })
    try {
      jest.setSystemTime(new Date('2026-07-12T00:00:00Z'))
      const { token, jwk } = makeEs256(validClaims(), 'kid-ttl')
      const first = jwksFetchOf(jwk)
      const cfg1 = esConfig(first)
      await expect(verifyBearer(token, cfg1)).resolves.toMatchObject({ sub: 'user-uuid-123' })

      // key removed upstream; move past the TTL
      jest.setSystemTime(new Date('2026-07-12T00:11:00Z'))
      const rotatedOut = jwksFetchOf({ kid: 'other-kid', kty: 'EC' })
      await expectReject(token, esConfig(rotatedOut), 'signature')
      expect(rotatedOut).toHaveBeenCalledTimes(1) // proves the stale cache was refetched
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('verifierConfigFromEnv — derived config, no hardcoded project', () => {
  it('derives issuer + jwksUri from AUTH_SUPABASE_URL', () => {
    const cfg = verifierConfigFromEnv({
      AUTH_SUPABASE_URL: 'https://jdbsqvlfwsmzfmisuwmw.supabase.co/',
      AUTH_SUPABASE_JWT_SECRET: SECRET,
    } as unknown as NodeJS.ProcessEnv)
    expect(cfg.issuer).toBe('https://jdbsqvlfwsmzfmisuwmw.supabase.co/auth/v1')
    expect(cfg.audience).toBe('authenticated')
    expect(cfg.jwksUri).toContain('/.well-known/jwks.json')
    expect(cfg.hs256Secret).toBe(SECRET)
  })

  it('missing AUTH_SUPABASE_URL fails loud (no default)', () => {
    expect(() => verifierConfigFromEnv({} as NodeJS.ProcessEnv)).toThrow(
      BearerVerifyError,
    )
  })
})
