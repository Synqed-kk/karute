// 監査ログ round 2, PR D2 — pure display-only helpers for AuditLogSection.tsx
// (PACKET-AUDITLOG-PR-D2-PAGE-2026-09-11.md). Kept in their own file (packet
// §1: "if it is >10 lines") — several small pure functions, each with its own
// table/boundary test, none of them React.
import type { AuditLogEvent } from '@/actions/audit-log'

/** I2 — which settings.auditLog.automation.* key names the job that wrote a
 *  system-actor row, or null for today's plain システム label. Specific
 *  matches win over the recording.transcribe* family: transcribe_storm is
 *  the hourly WATCH reporting a pattern, not the transcriber itself, even
 *  though its action name starts the same way (packet WHAT item 1). */
export function automationLabelKey(action: string): string | null {
  if (action === 'recording.karute_missing') return 'automation.watch'
  if (action === 'recording.transcribe_storm') return 'automation.watch'
  if (action === 'recording.capture_resumed') return 'automation.rescue'
  if (action === 'customer.pack_redeem') return 'automation.autoburn'
  if (action === 'recording.session_cleanup') return 'automation.cleanup'
  if (action.startsWith('recording.transcribe')) return 'automation.transcribe'
  return null
}

/** I6 — recording.karute_missing's detail.reason rides the recordings-inbox
 *  InboxReason vocabulary (5 real values reach it, pinned at source: run.ts's
 *  karuteMissingDetail copies row.reason verbatim — packet §ADDED 18:24) —
 *  collapsed to the 3 reason.* keys the page actually ships (YAGNI: no writer
 *  produces the other candidates named in the first native-pass table).
 *  Unknown/missing -> null (no reason word), never a raw code. */
export function karuteMissingReasonKey(reason: unknown): string | null {
  switch (reason) {
    case 'emptyTranscript':
      return 'reason.empty_transcript'
    case 'genericFailure':
      return 'reason.job_failed'
    case 'localAudio':
    case 'tailIncomplete':
    case 'serverAudio':
      return 'reason.not_transcribed'
    default:
      return null
  }
}

/** I6 — recording.transcribe_failed's detail.reason is already spelled as
 *  the key suffix at the writer (process-recording.ts:499: 'empty_transcript'
 *  | 'other') — just gate it to the two real values, never pass an unknown
 *  string through as a key. */
export function transcribeFailedReasonKey(reason: unknown): string | null {
  return reason === 'empty_transcript' || reason === 'other' ? `reason.${reason}` : null
}

/** I7 — cost_cents_estimate (Deepgram $/min estimate, USD cents:
 *  ai-rate-limit.ts's estimateTranscriptionCostCents) formatted as a
 *  pre-formatted "$X.XX" string for storm.sub — NEVER a ¥ prefix (packet
 *  §ADDED 18:1x: this is USD, not yen). */
export function formatStormCostUsd(costCents: number): string {
  return `$${(costCents / 100).toFixed(2)}`
}

/** I1 — fold repeats. Rows sharing (action, target_type, target_id,
 *  actor_id) AND an identical `detail` collapse into one group, held at the
 *  position of its FIRST occurrence in `events` — the caller always passes
 *  one DAY's worth, already newest-first, so "first occurrence" IS the
 *  newest member's position. NOT merely-adjacent grouping (matches the
 *  approved mock's own documented rule): a retry run interleaved with
 *  unrelated rows must still fold to one line, not split at every
 *  interruption. The `detail` term is a documented deviation from the
 *  packet's bare 4-tuple — see the key's own comment below. */
export interface FoldGroup {
  key: string
  events: AuditLogEvent[]
}
export function foldRepeats(events: AuditLogEvent[]): FoldGroup[] {
  const out: FoldGroup[] = []
  const byKey = new Map<string, FoldGroup>()
  for (const e of events) {
    // Packet deviation, documented (BUILD-REPORT-PR-D2-2026-09-11.md): the
    // packet's literal key is the bare 4-tuple. `detail` joins it because
    // settings.recording_autostart_toggle's ON/OFF pair (stress-audit F5b,
    // audit-log-section-menu-autostart-detail.test.tsx) shares that exact
    // 4-tuple while being TWO DIFFERENT FACTS — folding them would silently
    // drop whichever one lost the representative slot, re-introducing the
    // exact byte-identical-rows bug F5b was shipped to fix. A stable
    // same-writer JSON.stringify is enough to tell "true repeat" (identical
    // detail) from "same action, different fact" (detail differs) without
    // widening the key for every caller — never-destroy-information wins
    // over fold aggressiveness.
    const key = `${e.action}|${e.target_type}|${e.target_id}|${e.actor_id}|${JSON.stringify(e.detail)}`
    const existing = byKey.get(key)
    if (existing) {
      existing.events.push(e)
      continue
    }
    const group: FoldGroup = { key, events: [e] }
    byKey.set(key, group)
    out.push(group)
  }
  return out
}

/** I5 — how many days a range preset covers, or null for 'all'. Shared shape
 *  with presetFrom's own 7/30/90 mapping in AuditLogSection.tsx so the query
 *  window and the scope line can never say different numbers. */
export type RangePreset = '7d' | '30d' | '90d' | 'all'
export function rangeDays(preset: RangePreset): number | null {
  if (preset === '7d') return 7
  if (preset === '30d') return 30
  if (preset === '90d') return 90
  return null
}
