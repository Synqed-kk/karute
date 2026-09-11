/**
 * 監査ログ round 2, PR C — subject 1: which recording sessions never became a
 * karute and never will (PACKET-AUDITLOG-PR-C-SERVER-WATCH-2026-09-11.md item
 * 1, fix round 2 PACKET-PR-C1-FIX-ROUND2-GREPTILE-2026-09-11.md fix (a), fix
 * round 3 PACKET-PR-C1-FIX-ROUND3-PIN-2026-09-11.md).
 * Pure — fed the SAME InboxRow[] the 録音履歴 screen renders (deriveInboxRows,
 * inbox.ts:274), so this reads the exact fold a staffer already sees, never a
 * second guess at what "missing" means.
 *
 * A row is a candidate when it is 復元可能 or 失敗 (state 'recoverable' |
 * 'failed' — the two states 録音履歴 itself puts in 要対応). Those are the only
 * two states a record-less session can reach here: deriveInboxRows (fed
 * `takes: []` — this module never sees a device-local take) gives job FAILED
 * → `failed`, job DONE with no record → `failed`, no job + serverAudio ===
 * 'object' → `recoverable`, no job + serverAudio === 'segments' → `processing`
 * (reason `partialOnServer`) — never a candidate — and no job + no server
 * audio → `processing` inside SESSION_UNSETTLED_GRACE_MS, else `failed`. So a
 * session the nightly assembler could still rescue (loose segments on the
 * server, no whole object yet) is already excluded UPSTREAM by that
 * classifier: the assembler's own "newest segment ≥ ASSEMBLE_AFTER_MS"
 * eligibility never decides a candidate here — a `recoverable` row already
 * HAS its whole object, either the phone's own upload or the assembler's
 * rescue. What `assembleAfterMs` therefore waits for is the DEVICE'S silence,
 * not the assembler's turn: a `failed` row with no server audio is a phone
 * that has not drained yet, and the assembler's own docblock
 * (src/lib/recording/assembler.ts:43-50) names two days as where "gone"
 * becomes the likelier truth ("a phone that comes back within two days
 * secures the WHOLE take itself") — reusing its constant keeps the two waits
 * identical by construction. The session's end is `startedAt +
 * durationSeconds * 1000` when the duration is known, else `startedAt +
 * SESSION_UNSETTLED_GRACE_MS` (inbox.ts's own bound on an unsettled session —
 * the honest guess when no duration exists). A row is a candidate iff
 * `sessionEnd + assembleAfterMs <= floor`, the inclusive mirror of
 * assembler.ts:1002's strict `newest > now - ASSEMBLE_AFTER_MS` skip.
 *
 * ponytail: a paused-then-resumed phone has no wall-clock bound
 * (assembler.ts:52-60 — there is no server-side signal that tells it apart
 * from a dead one) — a row with no duration uses the inbox grace as its
 * honest bound rather than inventing a new ceiling.
 * ponytail: rows the inbox read did NOT actually probe (past
 * MAX_JOB_PROBES, or a storage probe that threw or answered 'unknown' —
 * inbox-read.ts ~:453, ~:560-585) read `failed` shape-identically to a real
 * miss; the WATCH (PR C2) is where that gets filtered, not this pure finder.
 */
import { SESSION_UNSETTLED_GRACE_MS, type InboxRow } from '@/lib/recordings/inbox'

/** The nightly assembler's own schedule (vercel.json `"7 18 * * *"`, UTC — the
 *  :07 is the fleet-spread habit, see /api/assemble's header). ONE constant so
 *  the two can never drift: `find-karute-missing.test.ts` reads vercel.json's
 *  literal cron string and asserts it parses to this same hour/minute. */
export const ASSEMBLER_CRON_UTC = { hour: 18, minute: 7 } as const

/** The most recent instant the assembler cron fired, on or before `now`. If
 *  today's 18:07 UTC has not happened yet, that is yesterday's. */
export function lastAssemblerPassAt(now: number): number {
  const d = new Date(now)
  const todays = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    ASSEMBLER_CRON_UTC.hour,
    ASSEMBLER_CRON_UTC.minute,
  )
  return todays <= now ? todays : todays - 24 * 60 * 60 * 1000
}

export function findKaruteMissing(input: {
  rows: readonly InboxRow[]
  now: number
  lastAssemblerPassAt: number
  assembleAfterMs: number
}): InboxRow[] {
  const { rows, now, lastAssemblerPassAt: floor, assembleAfterMs } = input
  return rows.filter((r) => {
    if (r.state !== 'recoverable' && r.state !== 'failed') return false
    if (r.startedAt > now) return false
    const sessionEnd =
      r.durationSeconds !== null ? r.startedAt + r.durationSeconds * 1000 : r.startedAt + SESSION_UNSETTLED_GRACE_MS
    return sessionEnd + assembleAfterMs <= floor
  })
}
