// Facade: revoke a pending staff invite (design-parity packet 12 §S4b).
// Single-source: calls the SAME revokeInviteCore the web revokeInvite
// action calls (src/actions/invites.ts).
//
// Gate: 'staff.invite' (invites.ts:170 — same capability as create/list;
// the whole invite surface is one capability).
//
// Business-result passthrough: revokeInviteCore's own { ok: true } |
// { error } result rides the 2xx body VERBATIM, matching the create route's
// RPC-style class — InviteStaffDialog ignores the result today, but the
// contract stays byte-identical to web regardless.
//
// audit: revokeInviteCore emits staff.invite_revoke itself — see the
// FACADE_AUDIT_MAP 'skip' row for 'invite.revoke' (src/lib/audit.ts).
//
// revocation: 'invite.revoke' is a facade WRITE — a new key this packet
// registers in REVOCATION_SENSITIVE_ENDPOINTS.

import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { revokeInviteCore } from '@/actions/invites'

export const runtime = 'nodejs'

type Params = { id: string }

export const DELETE = facadeHandler<Params>('invite.revoke', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'staff.invite')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'invite id is required')

  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const result = await revokeInviteCore(
    synqed,
    businessId,
    { actorId: ctx.identity.authUserId, source: 'facade' },
    id,
  )
  return ok(ctx, result)
})

export const OPTIONS = DELETE // facadeHandler short-circuits OPTIONS before auth.
