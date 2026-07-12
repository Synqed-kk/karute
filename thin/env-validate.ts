// Thin-target env validation — NO fallback defaults (R3 #20). The export/auth
// spikes silently defaulted to a prod + a dead Supabase host; a missing var here
// THROWS at build/boot instead. Pure over an env record so it is jest-testable
// without `import.meta.env` (env.ts is the import.meta wrapper).

export interface ThinEnv {
  /** API/site base for DataPort facade calls, e.g. https://karute-omega.vercel.app */
  facadeUrl: string
  /** Supabase auth project URL (mapped to packet-01 AUTH_SUPABASE_URL). */
  supabaseUrl: string
  /** Supabase anon (publishable) key — public by design. */
  supabaseAnonKey: string
  /** 'remote' (WebView loads live site) | 'local' (offline bundle). */
  mode: 'remote' | 'local'
  /** Embedded by the release pipeline; '' in dev is allowed (manifest shows dev). */
  commit: string
  buildNumber: string
}

const REQUIRED = ['VITE_FACADE_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const

export function validateThinEnv(env: Record<string, string | undefined>): ThinEnv {
  const missing = REQUIRED.filter((k) => !env[k])
  if (missing.length > 0) {
    throw new Error(
      `[thin] missing required env with no fallback default: ${missing.join(', ')}. ` +
        'Set these explicitly — the thin bundle must never silently default to a host.',
    )
  }
  const mode = env.VITE_SHELL_MODE === 'local' ? 'local' : 'remote'
  return {
    facadeUrl: env.VITE_FACADE_URL!,
    supabaseUrl: env.VITE_SUPABASE_URL!,
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY!,
    mode,
    commit: env.VITE_BUILD_COMMIT ?? '',
    buildNumber: env.VITE_BUILD_NUMBER ?? '0',
  }
}

/** Non-secret build manifest emitted per build (the anon key is omitted even
 *  though public — a manifest is for identifying a binary, not for keys). */
export function envManifest(env: ThinEnv): Record<string, string> {
  return {
    mode: env.mode,
    facadeUrl: env.facadeUrl,
    supabaseUrl: env.supabaseUrl,
    commit: env.commit || 'dev',
    buildNumber: env.buildNumber,
  }
}
