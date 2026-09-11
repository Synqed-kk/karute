// Facade: 監査ログ (audit log) list (design-parity packet 17 §S3). Single-
// source: calls the SAME twin the web listAuditLog() action delegates to
// (listAuditLogWithClient, src/actions/audit-log.ts) — the P-B pattern this
// design-parity effort standardizes on.
//
// Gate: 'audit.view' AND 'stores.viewAll' (PR B2 §4, canReadAuditLog —
// src/lib/auth/audit-read.ts), same predicate web enforces. Audit rows
// carry no store yet (⚖ 8/17 STORE ISOLATION LAW), so audit.view alone
// would let a branch-restricted holder read every store's rows.
//
// Query never 400s: this route's only client is the thin port, which always
// sends a well-formed query — a malformed/absent param degrades to its
// default (matching web's own optional-filter tolerance) rather than
// rejecting the request.
//
// Actor: resolved on EVERY call now (contract §3.1, PR-M1) — the twin writes
// its own privacy.audit_log.view row unconditionally, per invocation, so
// every call pays the roster round-trip; a client-supplied flag can no
// longer decide whether a read gets disclosed. `source: 'facade'` is a Fable
// ruling (audit rows carry truthful provenance, createStoreCore precedent);
// the row is otherwise byte-identical to web's. A Bearer user absent from
// the roster degrades to a null actorId (matching web's own
// getCurrentUserStaffId().catch(() => null)), never a throw.
//
// audit: 'audit.list' must NOT enter FACADE_AUDIT_MAP (src/lib/audit.ts) —
// the row is the twin's own unconditional write; a map entry would
// double-log, same reasoning as the stores.create/update 'skip' rows.
//
// revocation: 'audit.list' is a GET whose handler writes (the
// privacy.audit_log.view row) — see REVOCATION_SENSITIVE_ENDPOINTS
// (src/lib/auth/revocation.ts) and GET_ENDPOINTS_WITH_WRITE_SIDE_EFFECTS
// (app-api-revocation-coverage.test.ts), same registry stores.list closes.

import { facadeHandler, ok, type FacadeContext } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { canReadAuditLog } from '@/lib/auth/audit-read'
import { newSynqedClient } from '@/lib/synqed/client'
import { staffListByBusinessOrThrow } from '@/lib/staff'
import { listAuditLogWithClient, type AuditLogFilters } from '@/actions/audit-log'
import { AuditLogListResultDTO } from '@/lib/app-api/audit-log-dto'

export const runtime = 'nodejs'

const TARGET_TYPES = new Set(['customer', 'recording', 'karute', 'staff'])

function parseFilters(ctx: FacadeContext): AuditLogFilters {
  const q = new URL(ctx.req.url).searchParams
  const rawPage = Number.parseInt(q.get('page') ?? '', 10)
  const breakGlass = q.get('breakGlass') === '1'
  const rawTargetType = q.get('targetType')
  return {
    category: q.get('category') ?? undefined,
    actorId: q.get('actorId') ?? undefined,
    from: q.get('from') ?? undefined,
    to: q.get('to') ?? undefined,
    targetId: q.get('targetId') ?? undefined,
    // Amendment 4 F5: only the four real values are recognized — anything
    // else (a stale/typo'd param) is ignored, matching this route's
    // never-400s contract for every other filter (severity's own comment).
    targetType:
      rawTargetType && TARGET_TYPES.has(rawTargetType)
        ? (rawTargetType as AuditLogFilters['targetType'])
        : undefined,
    includeViews: q.get('includeViews') === '1',
    breakGlass,
    // G2 (round-4 line-audit): only these two real core literals are
    // recognized (a stale 'warnings' or any other unknown value is ignored),
    // matching this route's never-400s contract for every other filter. R1
    // (round-2 line-audit): breakGlass wins when both are set — mirrors the
    // twin's own normalization so the phone never sends the combination in
    // the first place.
    severity: !breakGlass && (q.get('severity') === 'warn' || q.get('severity') === 'critical')
      ? (q.get('severity') as 'warn' | 'critical')
      : undefined,
    page: rawPage > 0 ? rawPage : 1,
  }
}

export const GET = facadeHandler('audit.list', async (ctx) => {
  if (!canReadAuditLog(ctx.identity.capabilities)) {
    throw new AppApiError('forbidden', 'Missing capability: audit.view + stores.viewAll')
  }
  const businessId = ctx.identity.businessId
  const synqed = newSynqedClient(businessId)
  const filters = parseFilters(ctx)

  // Every call resolves the caller's staff row now (web parity:
  // getCurrentUserStaffId().catch(() => null)) — the roster round-trip is
  // paid on every invocation, per contract §3.1. requestId = the server mint
  // from facadeHandler's meta (PR-M5), one id per HTTP request.
  const actor = {
    staffId:
      (await staffListByBusinessOrThrow(businessId).catch(() => []))
        .find((s) => s.id === ctx.identity.authUserId)?.id ?? null,
    businessId,
    source: 'facade' as const,
    requestId: ctx.meta.requestId,
  }

  return ok(ctx, AuditLogListResultDTO.parse(await listAuditLogWithClient(synqed, actor, filters)))
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
