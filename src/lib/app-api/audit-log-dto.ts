// 監査ログ facade GET result DTO (design-parity packet 17 §S3). Mirrors
// listAuditLogWithClient's return union (src/actions/audit-log.ts)
// field-for-field — the twin's own {ok:false,error:'failed'} branch rides
// the 2xx body VERBATIM (web-contract parity, RPC precedent), so this is a
// discriminated union, not a single success shape.

import { z } from 'zod'

/** Mirrors AuditLogEvent (src/actions/audit-log.ts). */
const AuditLogEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  actor_id: z.string().nullable(),
  actor_type: z.string(),
  category: z.string(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  target_label: z.string().nullable(),
  detail: z.unknown(),
  break_glass: z.boolean(),
  severity: z.string(),
})

export const AuditLogListResultDTO = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    events: z.array(AuditLogEventSchema),
    total: z.number(),
    page: z.number(),
    hasMore: z.boolean(),
    breakGlassTotal: z.number().nullable(),
    targetLabels: z.record(z.string(), z.string()),
  }),
  z.object({
    ok: z.literal(false),
    error: z.enum(['forbidden', 'failed']),
  }),
])
