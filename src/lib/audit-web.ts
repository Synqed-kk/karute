// Web-side audit writer — the server-action / route-handler counterpart of the
// facade success hook (logFacadeAudit in src/lib/app-api/handler.ts). Wraps the
// pure emitter with cookie-session identity resolution and the same best-effort
// contract: an audit emit failure must never break the mutation it records
// (AUDIT-LOG-DESIGN.md §4 — the log proves presence, never absence). Kept out
// of audit.ts so the emitter itself stays dependency-free.
import { audit, type AuditEvent } from '@/lib/audit'
import { getBusinessId, resolveUserId } from '@/lib/staff'

type WebAuditEvent = Omit<AuditEvent, 'actorId' | 'actorType' | 'businessId' | 'source'> &
  Partial<Pick<AuditEvent, 'actorId' | 'businessId'>>

/** Emit one audit event from a web mutation. Actor + business default to the
 *  cookie-session identity (both resolvers are request-cached, so this adds no
 *  round-trip); pass them explicitly on paths where the session doesn't exist
 *  yet (acceptInvite) or the caller already holds them. Never throws. */
export async function auditWeb(e: WebAuditEvent): Promise<void> {
  try {
    audit({
      ...e,
      actorId: e.actorId !== undefined ? e.actorId : await resolveWebActorId(),
      businessId: e.businessId !== undefined ? e.businessId : await resolveWebBusinessId(),
      actorType: 'staff',
      source: 'web',
    })
  } catch {
    // Never let auditing break the action path (same rule as the facade hook).
  }
}

/** Best-effort actor id (design-parity packet 12 §S4a): the same tolerant
 *  resolveUserId() fallback auditWeb applies inline, exported for a web
 *  action whose audit call moved INTO a WithClient core (staff/permissions/
 *  stores/voice — the core takes an explicit actor, never a cookie, so the
 *  web wrapper resolves it up front). NOTE: wraps the call itself (not a
 *  chained `.catch`) so a test that mocks '@/lib/staff' without resolveUserId
 *  (leaving it undefined) degrades to null instead of throwing synchronously
 *  before any `.catch` could attach. */
export async function resolveWebActorId(): Promise<string | null> {
  try {
    return await resolveUserId()
  } catch {
    return null
  }
}

/** Same tolerance as {@link resolveWebActorId}, for getBusinessId(). Only for
 *  a core whose businessId is AUDIT-ONLY (never used to scope a query) — a
 *  core that needs businessId to scope a real read/write (updateStaffCore,
 *  setStaffPermissionsCore, …) resolves it directly and lets a failure there
 *  fail the whole mutation, exactly as before this split. */
export async function resolveWebBusinessId(): Promise<string | null> {
  try {
    return await getBusinessId()
  } catch {
    return null
  }
}

/** Combines both — the common case for a core whose businessId is
 *  audit-only (createStaffCore, uploadStaffAvatarCore). */
export async function resolveWebAuditContext(): Promise<{
  actorId: string | null
  businessId: string | null
}> {
  const [actorId, businessId] = await Promise.all([resolveWebActorId(), resolveWebBusinessId()])
  return { actorId, businessId }
}
