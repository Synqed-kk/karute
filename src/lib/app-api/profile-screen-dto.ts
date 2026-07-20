// Profile screen DTO — the Bearer twin of ProfilePageView's prop surface
// (design-parity packet 12 §B-2). Mirrors ProfilePageProfile
// (src/components/profile/redesign/ProfilePageView.tsx) field-for-field, so
// the thin screen renders ProfilePageView directly from this DTO — no
// per-field passthrough mapping.

import { z } from 'zod'

export const ProfileScreenDTO = z.object({
  name: z.string(),
  initials: z.string(),
  email: z.string(),
  role: z.enum(['owner', 'staff']),
  roleLabel: z.object({ ja: z.string(), en: z.string() }),
  storeName: z.object({ ja: z.string(), en: z.string() }),
})

export type ProfileScreenDTOType = z.infer<typeof ProfileScreenDTO>
