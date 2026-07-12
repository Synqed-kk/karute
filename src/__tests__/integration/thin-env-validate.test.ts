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
}

describe('validateThinEnv', () => {
  it('throws listing EVERY missing required var (no silent default)', () => {
    expect(() => validateThinEnv({})).toThrow(/VITE_FACADE_URL/)
    expect(() => validateThinEnv({})).toThrow(/VITE_SUPABASE_URL/)
    expect(() => validateThinEnv({})).toThrow(/VITE_SUPABASE_ANON_KEY/)
  })

  it('accepts a full env and defaults mode to remote', () => {
    const env = validateThinEnv(FULL)
    expect(env.facadeUrl).toBe(FULL.VITE_FACADE_URL)
    expect(env.mode).toBe('remote')
  })

  it('honors VITE_SHELL_MODE=local', () => {
    expect(validateThinEnv({ ...FULL, VITE_SHELL_MODE: 'local' }).mode).toBe('local')
  })

  it('manifest is non-secret: omits the anon key', () => {
    const manifest = envManifest(validateThinEnv({ ...FULL, VITE_BUILD_COMMIT: 'abc123' }))
    expect(JSON.stringify(manifest)).not.toContain('anon-key-public')
    expect(manifest.commit).toBe('abc123')
  })
})
