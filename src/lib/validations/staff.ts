import { z } from 'zod'

export const staffProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  position: z.string().max(100),
  email: z.string(),
  phone: z.string().max(20),
  /** 経営メンバー toggle (StaffForm's 権限 block). EXPLICIT and optional: zod
   *  strips unknown keys, so without this field the facade PATCH would accept
   *  the body and silently no-op the flag. Absent = leave the stored value
   *  alone (create mode and any older client never send it). */
  isManagement: z.boolean().optional(),
})

export type StaffProfileInput = z.infer<typeof staffProfileSchema>
