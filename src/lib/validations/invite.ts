import { z } from 'zod'
import { RESERVED_STAFF_NAME } from './staff'

// Roles an owner can invite into. Mirrors synqed-core's StaffRole minus OWNER
// (you can't mint another owner via an invite). Kept here so the dialog, the
// action, and the invites-table CHECK constraint all agree.
export const INVITE_ROLES = ['ADMIN', 'STYLIST', 'ASSISTANT'] as const
export type InviteRole = (typeof INVITE_ROLES)[number]

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required').max(255),
  role: z.enum(INVITE_ROLES),
  // When the invite is launched from an existing staff row, its id rides along so
  // acceptInvite LINKS that row (sets user_id) instead of minting a duplicate.
  staffId: z.string().uuid().optional(),
  /** ⚖ Liam 2026-09-16 — a FRESH invite now MAKES that staff row before the
   *  invite exists, so the person is placed in a store from the first moment
   *  rather than landing unassigned on accept. Both fields describe the CARD,
   *  not the invite, and both are ignored on a re-invite (the card already
   *  exists and owns its own name and stores).
   *
   *  Requiredness lives in createInviteCore, not here: `name` is required only
   *  for a fresh invite, and `storeIds` only for a fresh invite in a business
   *  with two or more stores — neither condition is expressible from the body
   *  alone. NEVER an email-named card: with no name the invite is refused. */
  name: z
    .string()
    .trim()
    .max(100)
    .refine((v) => !RESERVED_STAFF_NAME.test(v))
    .optional(),
  storeIds: z.array(z.string().uuid()).optional(),
})
export type InviteInput = z.infer<typeof inviteSchema>

// Password rule for accepting an invite — matches the signup form (minLength 8).
export const acceptInviteSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

// How long an invite link stays valid.
export const INVITE_TTL_DAYS = 7
