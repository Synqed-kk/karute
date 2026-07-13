// import.meta.env wrapper — the ONLY thin file that reads Vite env, so everything
// else (and jest) stays free of import.meta. Validation lives in env-validate.ts.
//
// LAZY on purpose (Fable review round 1, critical 3): a top-level throw here
// used to kill the app before React mounted — no ErrorBoundary, no splash
// release, white screen until the +8s failsafe. Now the entry (thin/main.tsx)
// calls getThinEnv() FIRST, catches, and renders a visible error screen; every
// other caller (data.vite.ts) resolves lazily after that gate has passed.

/// <reference types="vite/client" />
import { validateThinEnv, type ThinEnv } from './env-validate'

let cached: ThinEnv | undefined

export function getThinEnv(): ThinEnv {
  cached ??= validateThinEnv(
    import.meta.env as unknown as Record<string, string | undefined>,
  )
  return cached
}
