// Env validation with NO fallback defaults (packet-02 build #5). The export/auth
// spikes silently defaulted to prod + a dead host; this proves a missing var
// fails loud and the manifest stays non-secret.

import {
  validateThinEnv,
  envManifest,
} from '../../../thin/env-validate'

const FULL = {
  VITE_FACADE_URL: 'https://karute-omega.vercel.app',
  VITE_SUPABASE_URL: 'https://proj.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key-public',
  VITE_SHELL_MODE: 'remote',
}

describe('validateThinEnv', () => {
  it('throws listing EVERY missing required var (no silent default)', () => {
    expect(() => validateThinEnv({})).toThrow(/VITE_FACADE_URL/)
    expect(() => validateThinEnv({})).toThrow(/VITE_SUPABASE_URL/)
    expect(() => validateThinEnv({})).toThrow(/VITE_SUPABASE_ANON_KEY/)
  })

  it('accepts a full env with an explicit mode', () => {
    const env = validateThinEnv(FULL)
    expect(env.facadeUrl).toBe(FULL.VITE_FACADE_URL)
    expect(env.mode).toBe('remote')
    expect(validateThinEnv({ ...FULL, VITE_SHELL_MODE: 'local' }).mode).toBe('local')
  })

  it('mode is explicit: unset throws, typo throws (no silent remote default)', () => {
    expect(() =>
      validateThinEnv({ ...FULL, VITE_SHELL_MODE: undefined }),
    ).toThrow(/VITE_SHELL_MODE/)
    expect(() =>
      validateThinEnv({ ...FULL, VITE_SHELL_MODE: 'locol' }),
    ).toThrow(/locol/)
  })

  it('manifest is non-secret: omits the anon key', () => {
    const manifest = envManifest(validateThinEnv({ ...FULL, VITE_BUILD_COMMIT: 'abc123' }))
    expect(JSON.stringify(manifest)).not.toContain('anon-key-public')
    expect(manifest.commit).toBe('abc123')
  })
})
