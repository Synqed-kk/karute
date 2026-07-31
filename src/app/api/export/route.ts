import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { can } from '@/lib/auth/require-permission'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { auditWeb } from '@/lib/audit-web'
import { getBusinessId } from '@/lib/staff'
import { SCOPES, isWired, type ScopeKey, type FormatKey } from '@/lib/export/scopes'
import { exportCustomers } from '@/lib/export/export-customers'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Bulk customer export (PII) = data.export — the capability the presets give
  // owner / manager / senior only (practitioner + frontdesk lack it). The
  // /data-export page + nav link are NOT capability-gated in the UI today, so
  // this route was reachable by any signed-in staff; this is the enforcement
  // point. 403, not a thrown error, because this is an HTTP handler.
  if (!(await can('data.export'))) {
    return NextResponse.json(
      { error: 'You do not have permission to export data.' },
      { status: 403 },
    )
  }

  const url = new URL(request.url)
  const scope = (url.searchParams.get('scope') ?? 'customers') as ScopeKey
  const format = (url.searchParams.get('format') ?? 'csv') as FormatKey
  const privacy = url.searchParams.get('privacy') === '1'
  const columnsParam = url.searchParams.get('columns') ?? ''
  const columns = columnsParam ? columnsParam.split(',').filter(Boolean) : []

  if (!SCOPES[scope]) {
    return NextResponse.json({ error: 'Unknown scope' }, { status: 400 })
  }

  if (!isWired(scope, format)) {
    return NextResponse.json(
      { error: 'This combination is not yet wired — try customers + CSV/JSON.' },
      { status: 501 },
    )
  }

  // Store clamp (#465 family): only stores.viewAll (owner / manager / SV) gets
  // the business-wide export. Everyone else — restricted AND floating staff —
  // clamps to their resolved store lens. Deliberately STRICTER than the
  // customer-search convention (floating = every store): getStaffStores
  // swallows lookup failures to [], which reads as floating, and a transient
  // lookup error must not widen a bulk-PII export to the whole business
  // (Greptile P1 ×2 on this PR). Fail CLOSED at both layers: a thrown scope
  // resolution AND a non-viewAll scope with no resolvable store lens (double
  // lookup failure) both refuse the export — never fall through business-wide.
  let storeId: string | undefined
  try {
    const storeScope = await resolveStoreScope()
    if (!storeScope.viewAll && !storeScope.storeId) {
      return NextResponse.json(
        { error: 'Could not resolve your store scope.' },
        { status: 403 },
      )
    }
    storeId = storeScope.viewAll ? undefined : (storeScope.storeId ?? undefined)
  } catch {
    return NextResponse.json(
      { error: 'Could not resolve your store scope.' },
      { status: 403 },
    )
  }

  if (scope === 'customers') {
    // Cookie identity resolved ONCE here and passed explicitly — the core
    // takes no ambient identity (see export-customers.ts's header).
    const res = await exportCustomers({
      businessId: await getBusinessId(),
      columns,
      format,
      privacy,
      storeId,
    })
    // Bulk PII egress — logged with the QUERY SCOPE persisted (design §7): the
    // per-customer subject-access answer re-derives export membership from it.
    // Emitted only after the export body built successfully (errors above
    // throw/return before this line — errors are not actions).
    await auditWeb({
      category: 'privacy',
      action: 'privacy.customer_export',
      actorId: user.id,
      storeId,
      severity: 'notice',
      requestId: crypto.randomUUID(),
      detail: {
        scope,
        format,
        privacy,
        columns: columnsParam || null,
        store_id: storeId ?? null,
      },
    })
    return res
  }

  return NextResponse.json({ error: 'Unsupported scope' }, { status: 400 })
}
