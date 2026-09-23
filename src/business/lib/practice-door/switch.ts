// THE practice-door switch (DESIGN-PRACTICE-DOOR.md §1).
// BUSINESS_PRACTICE_TENANT unset or empty = OFF: every Business read stays on the
// fixture path, byte-for-byte what main renders. Set to the practice tenant's
// uuid = ON: data.ts hands each read to the door. A non-UUID value throws — a typo
// must never silently mean OFF.

import { cache } from 'react'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const practiceTenant = cache((): string | null => {
  const raw = process.env.BUSINESS_PRACTICE_TENANT
  if (raw === undefined || raw === '') return null
  if (!UUID.test(raw)) throw new Error('BUSINESS_PRACTICE_TENANT is set but is not a UUID')
  return raw.toLowerCase()
})
