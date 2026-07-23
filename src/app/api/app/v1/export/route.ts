// Facade: bulk customer export (design-parity packet 23). The Bearer-path
// twin of /api/export — same query params, same exportCustomers() core
// (src/lib/export/export-customers.ts, packet 23 §Build 1), same
// Content-Type/Content-Disposition, same 400/501s. Web's page + nav link are
// deliberately NOT capability-gated in the UI; this route is STILL the
// enforcement point (matches web's own comment).
//
// `export` is the facade endpoint key (NOT 'export.customers' or similar) —
// it is pre-registered in REVOCATION_SENSITIVE_ENDPOINTS (src/lib/auth/
// revocation.ts, PLAN §4: "staff CRUD, PIN, permissions, and data export").
// Using any other key would silently drop bulk-PII export off the real
// getUser() revocation round-trip and leave it on the local fast-path — a
// just-terminated staffer's still-unexpired Bearer token could keep
// exporting the whole customer book. Verified at source, not assumed.
//
// STORE CLAMP (fix round — the blind fleet caught the first version): exports
// use resolveExportStoreId (store-clamp.ts), NOT the ordinary-read
// `allowedStoreIds != null` convention. The list convention treats floating
// staff (empty assignment) as unrestricted — fine for reads, but web's
// /api/export deliberately clamps floating staff to their store lens (a rule
// it earned from two Greptile P1s; see its comment). The first cut here
// reused the list convention and silently reopened that bug class on the
// Bearer path. resolveExportStoreId keeps every tenancy/assignment
// fail-closed rule and adds the export-hardened floating clamp: header
// store ?? primary store, refuse if unresolvable.
//
// AUDIT (⚠ MUST-VERIFY, resolved at source): the facade's generic hook
// (FACADE_AUDIT_MAP + handler.ts's logFacadeAudit) classifies by endpoint key
// and carries NO custom `detail` — it cannot reproduce web's
// scope/format/privacy/columns/store_id payload (AUDIT-LOG-DESIGN §7, the
// subject-access answer re-derives export membership from that detail). No
// facade route calls the emitter directly with custom detail today (checked:
// no `audit(`/`auditWeb(` call under src/app/api/app/v1). This route is
// therefore the first, and emits directly via `audit()` — the SAME pure
// emitter auditWeb wraps — with source:'facade' and the identity's OWN
// actorId/businessId (no cookie to resolve). Deliberately NOT auditWeb: that
// wrapper hardcodes source:'web', which would misattribute a Bearer-
// originated bulk-PII export as a web action (flagged in the packet report).
//
// Envelope: matches the facade family's {error:{code,message}} convention
// (errors.ts), not web's bespoke {error:string} shape — 'not_implemented'
// (501) is a new additive AppApiErrorCode for the unwired-combo case, the
// facade's own convention already documents itself as additive-only.

import { facadeHandler } from '@/lib/app-api/handler'
import { AppApiError } from '@/lib/app-api/errors'
import { corsHeaders } from '@/lib/app-api/cors'
import { ensureCapability } from '@/lib/auth/require-permission'
import { newSynqedClient } from '@/lib/synqed/client'
import { resolveExportStoreId } from '@/lib/app-api/store-clamp'
import { exportCustomers } from '@/lib/export/export-customers'
import { audit } from '@/lib/audit'
import { SCOPES, isWired, type ScopeKey, type FormatKey } from '@/lib/export/scopes'

export const runtime = 'nodejs'

export const GET = facadeHandler('export', async (ctx) => {
  ensureCapability(ctx.identity.capabilities, 'data.export')

  const url = new URL(ctx.req.url)
  const scope = (url.searchParams.get('scope') ?? 'customers') as ScopeKey
  const format = (url.searchParams.get('format') ?? 'csv') as FormatKey
  const privacy = url.searchParams.get('privacy') === '1'
  const columnsParam = url.searchParams.get('columns') ?? ''
  const columns = columnsParam ? columnsParam.split(',').filter(Boolean) : []

  if (!SCOPES[scope]) {
    throw new AppApiError('validation', 'Unknown scope')
  }

  if (!isWired(scope, format)) {
    throw new AppApiError(
      'not_implemented',
      'This combination is not yet wired — try customers + CSV/JSON.',
    )
  }

  const synqed = newSynqedClient(ctx.identity.businessId)
  const storeId = await resolveExportStoreId({
    synqed,
    authUserId: ctx.identity.authUserId,
    capabilities: ctx.identity.capabilities,
    requestedStoreId: ctx.req.headers.get('store-id'),
  })

  if (scope === 'customers') {
    // businessId from the VERIFIED BEARER IDENTITY, explicitly — the core
    // takes no ambient identity (fix round: the first cut let the core
    // re-resolve identity from cookies via listCustomers/getBusinessId,
    // which on this path ignored the token identity entirely — cross-tenant
    // read if a cookie rode the request, hard 500 for the cookieless shell).
    const res = await exportCustomers({
      businessId: ctx.identity.businessId,
      columns,
      format,
      privacy,
      storeId,
    })
    // Bulk PII egress — logged with the QUERY SCOPE persisted (AUDIT-LOG-
    // DESIGN §7), AFTER the body builds successfully (errors above throw
    // before this line — errors are not actions). See the header comment for
    // why this calls audit() directly instead of the generic facade hook.
    audit({
      category: 'privacy',
      action: 'privacy.customer_export',
      actorId: ctx.identity.authUserId,
      actorType: 'staff',
      businessId: ctx.identity.businessId,
      severity: 'notice',
      source: 'facade',
      detail: {
        scope,
        format,
        privacy,
        columns: columnsParam || null,
        store_id: storeId ?? null,
      },
    })
    for (const [k, v] of Object.entries(corsHeaders(ctx.origin))) {
      res.headers.set(k, v)
    }
    res.headers.set('request-id', ctx.meta.requestId)
    return res
  }

  throw new AppApiError('validation', 'Unsupported scope')
})

export const OPTIONS = GET // facadeHandler short-circuits OPTIONS before auth.
