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
      actorId: e.actorId !== undefined ? e.actorId : await resolveUserId().catch(() => null),
      businessId:
        e.businessId !== undefined ? e.businessId : await getBusinessId().catch(() => null),
      actorType: 'staff',
      source: 'web',
    })
  } catch {
    // Never let auditing break the action path (same rule as the facade hook).
  }
}
