// Welcome screen DTO — the Bearer twin of the /welcome page's prop surface
// (design-parity packet 21). Mirrors the web page's own derivation
// (src/app/[locale]/(app)/welcome/page.tsx) field-for-field, so the thin
// screen renders WelcomeWizard directly from this DTO — no per-field
// passthrough mapping.

import { z } from 'zod'

export const WelcomeScreenDTO = z.object({
  salon_name: z.string(),
  business_type: z.string(),
  recording_disclosure_mode: z.enum(['A', 'B', 'C']).nullable(),
})

export type WelcomeScreenDTOType = z.infer<typeof WelcomeScreenDTO>
