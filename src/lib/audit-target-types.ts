// Subject 10 (PR D1 fix round 1, 2026-09-11): the four `targetType` values the
// 監査ログ reader recognizes (src/actions/audit-log.ts's `AuditLogFilters`) and
// the facade route validates against (route.ts) — ONE shared list so the two
// doors can never diverge. Lives OUTSIDE src/actions/audit-log.ts on purpose:
// that file is 'use server', and Next.js only allows async function exports
// from a 'use server' module (a plain `export const` fails `next build` —
// proven at src/actions/audit-log.ts:88's history). Deliberately NOT derived
// from src/lib/audit.ts's `AuditEvent['targetType']` — that union is wider
// (adds 'business' | 'store' | 'menu' for general audit emission) and is a
// different concern from this reader-specific allow-list.
export const AUDIT_TARGET_TYPES = new Set<string>(['customer', 'recording', 'karute', 'staff'])
