// import.meta.env wrapper — the ONLY thin file that reads Vite env, so everything
// else (and jest) stays free of import.meta. Validation lives in env-validate.ts.

/// <reference types="vite/client" />
import { validateThinEnv, type ThinEnv } from './env-validate'

export const thinEnv: ThinEnv = validateThinEnv(
  import.meta.env as unknown as Record<string, string | undefined>,
)
