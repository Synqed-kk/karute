import { z } from 'zod'

import { BUSINESS_TYPE_OPTIONS } from '@/lib/welcome/business-types'

const BUSINESS_TYPE_VALUES = BUSINESS_TYPE_OPTIONS.map((o) => o.value)

export const storeSchema = z.object({
  name: z.string().trim().min(1, 'Store name is required').max(120),
  address: z.string().trim().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  /** Which of the 26 verticals this location is — drives the per-store AI
   *  persona (business-ai-tokens) and store-scoped defaults. Must be one of
   *  the canonical BUSINESS_TYPES values. */
  business_type: z
    .string()
    .refine((v) => BUSINESS_TYPE_VALUES.includes(v), 'Unknown business type'),
})
export type StoreInput = z.infer<typeof storeSchema>
