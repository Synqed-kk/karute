// Facade: staff authority read + write (design-parity packet 12 §S4a).
// Single-source: both routes call the SAME cores the web actions call
// (getStaffPermissionsCore / setStaffPermissionsCore, src/actions/permissions.ts).
//
// Gate: 'staff.manage' on BOTH — matches web's requireCapability('staff.manage')
// on getStaffPermissions/setStaffPermissions. The PUT additionally carries all
// three invariants moved INTO setStaffPermissionsCore so web and facade can
// never diverge: never target the owner, no-escalation-by-delta (a caller can
// only grant a capability they hold themselves), and audit.view grants are
// owner-only (Liam ruling 7/17). callerStaffId is the confirmed Bearer auth
// user id directly (profiles.id === auth.users.id, no extra roster lookup
// needed — businessIdForUser already proved this identity is an active member
// of this business during identity resolution).
//
// Business-result passthrough: both cores' own result shape rides the 2xx
// body VERBATIM (RPC-style, same class as stores.update/org-settings PATCH) —
// StaffForm branches on 'error' in result exactly as it does against the web
// action.
//
// audit: setStaffPermissionsCore emits settings.permissions_change itself —
// see the FACADE_AUDIT_MAP 'skip' row for 'permissions.update'
// (src/lib/audit.ts). GET is a read; no audit row (list/single-fetch reads
// don't log, same ruling as every other settings GET).
//
// revocation: 'permissions.update' is a facade WRITE and was already
// pre-registered in REVOCATION_SENSITIVE_ENDPOINTS
// (src/lib/auth/revocation.ts) before this packet. The GET stays OUT — a
// pure authority read, same posture as every other non-sensitive GET.

import { z } from 'zod'
import { facadeHandler, ok } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { ensureStaffWriteInScope } from '@/lib/app-api/store-clamp'
import { getStaffPermissionsCore, setStaffPermissionsCore } from '@/actions/permissions'
import { PERMISSION_ROLES, CAPABILITIES } from '@/lib/auth/permissions'

export const runtime = 'nodejs'

type Params = { id: string }

const SetPermissionsBody = z.object({
  permissionRole: z.enum(PERMISSION_ROLES),
  capabilities: z.array(z.enum(CAPABILITIES)),
})

export const GET = facadeHandler<Params>('permissions.get', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'staff.manage')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'staff id is required')

  const result = await getStaffPermissionsCore(ctx.identity.businessId, id)
  return ok(ctx, result)
})

export const PUT = facadeHandler<Params>('permissions.update', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'staff.manage')
  const { id } = await ctx.route.params
  if (!id) throw new AppApiError('validation', 'staff id is required')

  // Actor store scope — the Bearer twin of the clamp permissions.ts applies on
  // web, placed before the body parse (the #715 ordering) and before the core.
  await ensureStaffWriteInScope({
    synqed: newSynqedClient(ctx.identity.businessId),
    businessId: ctx.identity.businessId,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    targetStaffId: id,
  })

  let body: unknown
  try {
    body = await ctx.req.json()
  } catch {
    throw new AppApiError('validation', 'request body must be JSON')
  }
  const parsed = SetPermissionsBody.safeParse(body)
  if (!parsed.success) {
    throw new AppApiError('validation', parsed.error.issues.map((i) => i.message).join(', '))
  }

  const result = await setStaffPermissionsCore(
    ctx.identity.businessId,
    {
      callerStaffId: ctx.identity.authUserId,
      callerCapabilities: ctx.identity.capabilities,
      actorId: ctx.identity.authUserId,
      source: 'facade',
      requestId: ctx.meta.requestId,
    },
    id,
    parsed.data.permissionRole,
    parsed.data.capabilities,
  )
  return ok(ctx, result)
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
