// i18n label totality (packet-audit-viewer-labels-scroll, 2026-07-28): the
// permissions UI resolves a capability chip via `cap_${cap.replace('.', '_')}`
// (StaffForm.tsx) against the 'permissions' namespace, and the 監査ログ viewer
// resolves a row via `t(`actions.${action}`)` (AuditLogSection.tsx's
// actionLabel) against the 'settings.auditLog' namespace — next-intl DOT-NESTS
// both, and renders the raw dotted key when a lookup misses (the exact
// "English leak" class Liam saw in the field). i18n-key-parity.test.ts and
// facade-audit-labels.test.ts already guard en⇄ja parity and the
// FACADE_AUDIT_MAP/API_ROUTE_DECISIONS subset — this suite is the totality
// gate: it walks the SOURCE-OF-TRUTH registries (CAPABILITIES,
// src/lib/auth/permissions.ts; AUDIT_ACTIONS, src/lib/audit-policy.ts)
// directly, so a brand-new capability or audit action with no ja+en label
// fails HERE forever, in both locales, instead of shipping as a live raw-key
// render.
import en from '../../../messages/en.json'
import ja from '../../../messages/ja.json'
import { CAPABILITIES } from '@/lib/auth/permissions'
import { AUDIT_ACTIONS } from '@/lib/audit-policy'

type Json = { [k: string]: unknown }

// Mirrors next-intl's own resolution: split the dotted key on '.', walk the
// nested JSON object one segment at a time.
function resolve(messages: Json, path: string): string | undefined {
  let node: unknown = messages
  for (const seg of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Json)[seg]
  }
  return typeof node === 'string' ? node : undefined
}

function expectLabel(messages: Json, key: string) {
  const label = resolve(messages, key)
  expect(typeof label).toBe('string')
  expect((label ?? '').length).toBeGreaterThan(0)
}

describe('i18n label totality — CAPABILITIES + AUDIT_ACTIONS members all resolve, ja + en', () => {
  it('sanity: the registries this suite checks are non-empty (an emptied filter must not go silently green)', () => {
    expect(CAPABILITIES.length).toBeGreaterThan(0)
    expect(AUDIT_ACTIONS.length).toBeGreaterThan(0)
  })

  // Same key shape as StaffForm.tsx: `cap_${c.replace('.', '_')}` (single
  // replace, not replaceAll — matches production exactly; every current
  // capability has exactly one dot, so this is not a lurking behavior gap).
  it.each(CAPABILITIES)('permissions.cap_%s resolves in ja and en', (cap) => {
    const key = `permissions.cap_${cap.replace('.', '_')}`
    expectLabel(ja as Json, key)
    expectLabel(en as Json, key)
  })

  it.each(AUDIT_ACTIONS)('settings.auditLog.actions.%s resolves in ja and en', (action) => {
    const key = `settings.auditLog.actions.${action}`
    expectLabel(ja as Json, key)
    expectLabel(en as Json, key)
  })
})
