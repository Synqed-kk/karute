import { z } from 'zod'

/** Names reserved for system rows: the roster hides `full_name ILIKE
 *  '_system_%'` and the identity seam refuses `_system_removed_`, so a person
 *  given one drops off the roster or is locked out. Case-insensitive like the
 *  ILIKE; each schema tests the TRIMMED value. The one home — both name writers
 *  (this schema and inviteSchema) import it. */
export const RESERVED_STAFF_NAME = /^_system_/i

export const staffProfileSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name is too long')
    .refine((v) => !RESERVED_STAFF_NAME.test(v.trim())),
  position: z.string().max(100),
  email: z.string(),
  phone: z.string().max(20),
  /** 経営メンバー toggle (StaffForm's 権限 block). EXPLICIT and optional: zod
   *  strips unknown keys, so without this field the facade PATCH would accept
   *  the body and silently no-op the flag. Absent = leave the stored value
   *  alone (create mode and any older client never send it). */
  isManagement: z.boolean().optional(),
  /** 担当店舗 at CREATION (⚖ Liam 2026-09-16). Required by the server for a
   *  multi-store business — a card born with no store is a staff member who
   *  sees the 担当店舗が未設定です screen on their first login. Optional in the
   *  SHAPE so a single-store business (and every edit, which still saves
   *  stores through setStaffStores) sends nothing; the rule lives server-side
   *  in createStaffCore, not in the schema, because it depends on how many
   *  stores the business has. */
  storeIds: z.array(z.string().uuid()).optional(),
})

export type StaffProfileInput = z.infer<typeof staffProfileSchema>
