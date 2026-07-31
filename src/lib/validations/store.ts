import { z } from 'zod'

import { BUSINESS_TYPE_OPTIONS } from '@/lib/welcome/business-types'

const BUSINESS_TYPE_VALUES = BUSINESS_TYPE_OPTIONS.map((o) => o.value)

export const storeSchema = z.object({
  name: z.string().trim().min(1, 'Store name is required').max(120),
  address: z.string().trim().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  /** Which of the 26 verticals this location is — drives the per-store AI
   *  persona (business-ai-tokens) and store-scoped defaults. Must be one of
   *  the canonical BUSINESS_TYPES values. Optional at the schema so EDITS to
   *  pre-column stores never block (Greptile, #397) — createStore enforces
   *  presence for new stores. */
  business_type: z
    .string()
    .refine((v) => BUSINESS_TYPE_VALUES.includes(v), 'Unknown business type')
    .optional(),
})
export type StoreInput = z.infer<typeof storeSchema>

/** Owner-denial message — single source so the facade routes' exact-string
 *  403 elevation (a non-owner core result vs. every other soft error) can
 *  never drift out of sync with a wording change here. Lives here (not
 *  src/actions/stores.ts) because that module is 'use server' — Next/
 *  Turbopack rejects any non-async-function export from a "use server"
 *  file, and this is a plain string constant. */
export const STORE_OWNER_DENIAL = 'Only the salon owner can manage stores.'
