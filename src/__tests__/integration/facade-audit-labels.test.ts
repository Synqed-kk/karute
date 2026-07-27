// Viewer label coverage for every LIVE audit action (contract §3.1, PR-M4
// fix round F2). AuditLogSection.tsx resolves a row's label via
// `t(\`actions.${action}\`)` against the 'settings.auditLog' namespace
// (src/components/settings/redesign/sections/AuditLogSection.tsx —
// actionLabel()) — next-intl dot-nests the action string itself, so
// 'customer.pack_undo' resolves messages.settings.auditLog.actions.customer
// .pack_undo. A map row can add a real action string without ever adding its
// label — the exact bug this test generalizes and pins (found: 10 rows
// added with FACADE_AUDIT_MAP totality, none had a matching messages entry
// in either locale). Mirrors i18n-key-parity.test.ts's flatten approach,
// scoped to just this one surface so a missing label fails HERE with the
// action name, not as a silent raw-key render in the UI.
import en from '../../../messages/en.json'
import ja from '../../../messages/ja.json'
import {
  API_ROUTE_DECISIONS,
  FACADE_AUDIT_MAP,
  type ApiRouteDecision,
  type FacadeAuditRule,
  type FacadeEndpointKey,
} from '@/lib/audit'

type Json = { [k: string]: unknown }

function flattenKeys(obj: Json, prefix = ''): Set<string> {
  const keys = new Set<string>()
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const sub of flattenKeys(v as Json, key)) keys.add(sub)
    } else {
      keys.add(key)
    }
  }
  return keys
}

// Same "row is live" predicate FIX 5's parameterized pins use — kept in sync
// deliberately (both are reading the same disposition off the same rule).
function isLive(rule: FacadeAuditRule): boolean {
  return rule.kind !== 'skip' && rule.pendingWave === undefined
}

const liveFacadeActions = (Object.keys(FACADE_AUDIT_MAP) as FacadeEndpointKey[])
  .map((key) => FACADE_AUDIT_MAP[key])
  .filter(isLive)
  .map((rule) => rule.action)

// API_ROUTE_DECISIONS carries no structured `action` field (ApiRouteDecision
// only has kind/justification/dated/pendingWave — ADDING one is a schema
// change outside this fix round's scope, see the FIX 3 note on keeping
// kinds/decisions unchanged). Every currently-live (non-skip, non-pendingWave)
// decision's actual emit action is hand-verified against src/lib/audit.ts
// below; the substring check re-confirms each citation still appears in that
// decision's own justification prose, so an edit that silently changes the
// cited action without updating this list fails loud instead of drifting.
const LIVE_API_ROUTE_DECISION_ACTIONS: Array<{ path: string; action: string }> = [
  { path: 'sync/quickreserve', action: 'settings.sync_run_now' },
  { path: 'sync/quickreserve/config.POST', action: 'settings.sync_config_update' },
  { path: 'export', action: 'privacy.customer_export' },
]

// `'kind' in entry` doesn't narrow the union away here: Record<string,
// ApiRouteDecision>'s index signature structurally accepts a 'kind' key too
// (TS can't tell it apart from the flat ApiRouteDecision shape), so the
// discriminant has to check the FIELD'S TYPE instead — ApiRouteDecision.kind
// is a string; the Record branch's 'kind' entry (if any) would be an object.
function isFlatDecision(entry: ApiRouteDecision | Record<string, ApiRouteDecision>): entry is ApiRouteDecision {
  return typeof (entry as ApiRouteDecision).kind === 'string'
}

function resolveDecisionJustification(path: string): string {
  const [key, method] = path.split('.')
  const entry = API_ROUTE_DECISIONS[key]
  if (!entry) throw new Error(`facade-audit-labels self-check: missing API_ROUTE_DECISIONS['${key}']`)
  if (isFlatDecision(entry)) return entry.justification
  const methodEntry = method ? entry[method] : undefined
  if (!methodEntry) {
    throw new Error(`facade-audit-labels self-check: missing API_ROUTE_DECISIONS['${key}'].${method}`)
  }
  return methodEntry.justification
}

describe('audit action label coverage (settings.auditLog.actions, en ⇄ ja)', () => {
  const enKeys = flattenKeys(en as Json)
  const jaKeys = flattenKeys(ja as Json)

  it('sanity: found the live actions this suite is about to check', () => {
    // Guards against a future refactor emptying the filter and this suite
    // silently checking nothing (an always-green test is worse than none).
    expect(liveFacadeActions.length).toBeGreaterThan(0)
    expect(LIVE_API_ROUTE_DECISION_ACTIONS.length).toBeGreaterThan(0)
  })

  it.each(liveFacadeActions)('FACADE_AUDIT_MAP action %s has a label in en and ja', (action) => {
    const flatKey = `settings.auditLog.actions.${action}`
    expect(enKeys.has(flatKey)).toBe(true)
    expect(jaKeys.has(flatKey)).toBe(true)
  })

  it.each(LIVE_API_ROUTE_DECISION_ACTIONS)(
    'API_ROUTE_DECISIONS[$path] action $action has a label in en and ja (and is still cited at source)',
    ({ path, action }) => {
      expect(resolveDecisionJustification(path)).toContain(action)
      const flatKey = `settings.auditLog.actions.${action}`
      expect(enKeys.has(flatKey)).toBe(true)
      expect(jaKeys.has(flatKey)).toBe(true)
    },
  )

  it("audit.unmapped_endpoint has a label in en and ja — it's emitted directly by reportUnmappedEndpoint (src/lib/app-api/handler.ts), not driven by a FACADE_AUDIT_MAP/API_ROUTE_DECISIONS row, so the loops above never reach it", () => {
    const flatKey = 'settings.auditLog.actions.audit.unmapped_endpoint'
    expect(enKeys.has(flatKey)).toBe(true)
    expect(jaKeys.has(flatKey)).toBe(true)
  })
})
