import { z } from 'zod'

export const staffProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  position: z.string().max(100),
  email: z.string(),
  phone: z.string().max(20),
})

export type StaffProfileInput = z.infer<typeof staffProfileSchema>
