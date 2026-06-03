import { z } from 'zod'

export const storeSchema = z.object({
  name: z.string().trim().min(1, 'Store name is required').max(120),
  address: z.string().trim().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
})
export type StoreInput = z.infer<typeof storeSchema>
