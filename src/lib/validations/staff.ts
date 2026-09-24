import { z } from 'zod'

/** Names the roster would hide. The roster drops `full_name ILIKE '_system_%'`
 *  (src/lib/staff.ts), and in LIKE `_` is a ONE-CHARACTER WILDCARD — so it hides
 *  any name whose characters 2–7 are "system" and that has an 8th character
 *  (`_system_x`, but also `1system2alice`, `Asystemic`). A person given such a
 *  name is active but invisible to the owner; `_system_removed_` is also
 *  refused by the identity seam. So this rule refuses the WHOLE family the
 *  filter hides — any one character (newline included), "system", any one
 *  character — case-insensitive like the ILIKE. Narrowing both together
 *  (escaping the filter's `_`) is queued, not done here. The one home: the
 *  staff schema, inviteSchema and acceptInvite all use it. */
export const RESERVED_STAFF_NAME = /^[\s\S]system[\s\S]/i

export const staffProfileSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name is too long')
    // The name is stored as typed, so test it as typed (what the filter sees)
    // and trimmed (a leading space never slips a `_system_` name past).
    .refine((v) => !RESERVED_STAFF_NAME.test(v) && !RESERVED_STAFF_NAME.test(v.trim())),
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
