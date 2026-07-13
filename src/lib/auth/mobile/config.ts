// Client auth config for the mobile bundle (PLAN §4, packet-01 point 1).
//
// AUTH and STORAGE are DISTINCT parameters (PLAN §4) — never one variable. This
// file carries ONLY the auth-plane config; the recordings/storage bucket config
// is separate and lives elsewhere. A custom-domain swap or future project move
// is a config change, never a code change.
//
// NO FALLBACK DEFAULT. A missing var throws at boot — the spike's silent default
// to a dead prod host is exactly the failure this prevents. Fail loud, early.

export interface AuthClientConfig {
  /** Supabase auth project URL, e.g. https://<project>.supabase.co */
  url: string
  /** Supabase anon (publishable) key — public by design. */
  anonKey: string
}

/**
 * Load and validate the auth-client config from an env record.
 *
 * The env SOURCE is the caller's: the Vite thin target passes `import.meta.env`
 * (VITE_-prefixed vars re-exported as AUTH_*), Next/tests pass `process.env`.
 * Keeping the source out of this module is what makes it testable and
 * platform-neutral.
 */
export function loadAuthClientConfig(
  env: Record<string, string | undefined>,
): AuthClientConfig {
  const url = env.AUTH_SUPABASE_URL
  const anonKey = env.AUTH_SUPABASE_ANON_KEY

  const missing: string[] = []
  if (!url) missing.push('AUTH_SUPABASE_URL')
  if (!anonKey) missing.push('AUTH_SUPABASE_ANON_KEY')
  if (missing.length > 0) {
    throw new Error(
      `[auth] missing required config with no fallback default: ${missing.join(', ')}. ` +
        'Set these explicitly — do not let auth silently default to a project.',
    )
  }
  return { url: url!, anonKey: anonKey! }
}
