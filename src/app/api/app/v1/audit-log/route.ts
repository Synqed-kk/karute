// Facade: 監査ログ (audit log) list (design-parity packet 17 §S3). Single-
// source: calls the SAME twin the web listAuditLog() action delegates to
// (listAuditLogWithClient, src/actions/audit-log.ts) — the P-B pattern this
// design-parity effort standardizes on.
//
// Gate: 'audit.view', same predicate web enforces (ensureCapability against
// getMyCapabilities() there, against the Bearer-resolved capability set
// here) — owner-vs-grant is already resolved inside the capability set, so
// no extra owner check is needed on this path.
//
// Query never 400s: this route's only client is the thin port, which always
// sends a well-formed query — a malformed/absent param degrades to its
// default (matching web's own optional-filter tolerance) rather than
// rejecting the request.
//
// Actor / logOpen: `filters.logOpen` gates BOTH the roster read below and
// the twin's own privacy.audit_log_view write — a filter/page fetch (no
// logOpen) never pays the roster round-trip. `source: 'facade'` is a Fable
// ruling (audit rows carry truthful provenance, createStoreCore precedent);
// the row is otherwise byte-identical to web's. A Bearer user absent from
// the roster degrades to a null actorId (matching web's own
// getCurrentUserStaffId().catch(() => null)), never a throw.
//
// audit: 'audit.list' must NOT enter FACADE_AUDIT_MAP (src/lib/audit.ts) —
// its row is the twin's own logOpen write; a map entry would double-log
// opens, same reasoning as the stores.create/update 'skip' rows.
//
// revocation: 'audit.list' is a GET whose handler can write (the logOpen
// open row) — see REVOCATION_SENSITIVE_ENDPOINTS (src/lib/auth/revocation.ts)
// and GET_ENDPOINTS_WITH_WRITE_SIDE_EFFECTS
// (app-api-revocation-coverage.test.ts), same registry stores.list closes.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { listAuditLogWithClient, type AuditLogFilters } from '@/actions/audit-log'
import { AuditLogListResultDTO } from '@/lib/app-api/audit-log-dto'

export const runtime = 'nodejs'

function parseFilters(ctx: FacadeContext): AuditLogFilters {
  const q = new URL(ctx.req.url).searchParams
  const rawPage = Number.parseInt(q.get('page') ?? '', 10)
  return {
    category: q.get('category') ?? undefined,
    actorId: q.get('actorId') ?? undefined,
    from: q.get('from') ?? undefined,
    targetId: q.get('targetId') ?? undefined,
    includeViews: q.get('includeViews') === '1',
    breakGlass: q.get('breakGlass') === '1',
    logOpen: q.get('logOpen') === '1',
    page: rawPage > 0 ? rawPage : 1,
  }
}

export const GET = facadeHandler('audit.list', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'audit.view')
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const filters = parseFilters(ctx)

  // No roster tax on filter/page fetches — only a logOpen fetch resolves the
  // caller's staff row (web parity: getCurrentUserStaffId().catch(() => null)).
  const actor = filters.logOpen
    ? {
        staffId:
          (await staffListByBusinessOrThrow(businessId).catch(() => []))
            .find((s) => s.id === ctx.identity.authUserId)?.id ?? null,
        businessId,
        source: 'facade' as const,
      }
    : null

  return ok(ctx, AuditLogListResultDTO.parse(await listAuditLogWithClient(synqed, actor, filters)))
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
