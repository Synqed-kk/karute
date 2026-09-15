/**
 * 監査ログ round 2, PR C — subject 2: retry storms (PACKET-AUDITLOG-PR-C-
 * SERVER-WATCH-2026-09-11.md item 2). Pure — fed the business's raw
 * `recording.transcribe` receipt rows (the emit at src/lib/ai/transcribe.ts's
 * auditTranscriptionReceipt, one per attempt). More than three receipts for
 * the SAME recording session on the SAME JST calendar day is the same shape
 * the 9/10 field find caught by hand (a 21-call storm, $6.93): this turns
 * counting rows by hand into a row in the log itself.
 */
import type { AuditEvent } from '@synqed-kk/client'
import { ymdInJst } from '@/lib/date/jst'

const STORM_THRESHOLD = 3

export interface TranscribeStorm {
  targetId: string
  day: string
  count: number
  costCentsEstimate: number
  /** True when the events this ran over may not be the day's WHOLE set — the
   *  caller could not page this day to completion (budget or a page cap). A
   *  storm found in a partial read is still real; an undercount never is, so
   *  this rides along rather than being silently dropped. */
  truncated: boolean
  ids: string[]
  customerId: string | null
  staffId: string | null
}

function detailField(detail: unknown, key: string): unknown {
  return detail && typeof detail === 'object' ? (detail as Record<string, unknown>)[key] : undefined
}

function detailNumber(detail: unknown, key: string): number {
  const v = detailField(detail, key)
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function detailString(detail: unknown, key: string): string | null {
  const v = detailField(detail, key)
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** The first non-null value for `key` across the group, in the group's own
 *  order — not just the first receipt's, which may carry no customer_id at
 *  all (the web transcription receipt emits none; fix round 2 finding (b)). */
function firstString(group: readonly AuditEvent[], key: string): string | null {
  for (const e of group) {
    const v = detailString(e.detail, key)
    if (v !== null) return v
  }
  return null
}

/**
 * @param truncated The caller's own read did not finish paging every
 *   `recording.transcribe` event in the window (deadline or page cap) — see
 *   the route's step 4(b). Conservative: when true, every storm this run
 *   finds is marked truncated, since a partial page means no day's count in
 *   this batch is provably whole.
 */
export function findTranscribeStorms(input: {
  events: readonly AuditEvent[]
  truncated: boolean
}): TranscribeStorm[] {
  const groups = new Map<string, AuditEvent[]>()
  for (const e of input.events) {
    if (e.action !== 'recording.transcribe' || !e.target_id) continue
    const day = ymdInJst(new Date(e.at))
    const key = `${e.target_id}|${day}`
    const group = groups.get(key)
    if (group) group.push(e)
    else groups.set(key, [e])
  }

  const storms: TranscribeStorm[] = []
  for (const [key, group] of groups) {
    if (group.length <= STORM_THRESHOLD) continue
    const [targetId, day] = key.split('|')
    storms.push({
      targetId,
      day,
      count: group.length,
      costCentsEstimate: group.reduce(
        (sum, e) =>
          sum + Math.max(detailNumber(e.detail, 'cost_cents'), detailNumber(e.detail, 'cents_reserved')),
        0,
      ),
      truncated: input.truncated,
      ids: group.map((e) => e.id),
      customerId: firstString(group, 'customer_id'),
      staffId: firstString(group, 'staff_id'),
    })
  }
  return storms
}
