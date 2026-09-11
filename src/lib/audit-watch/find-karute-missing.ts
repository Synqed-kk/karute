/**
 * 監査ログ round 2, PR C — subject 1: which recording sessions never became a
 * karute and never will (PACKET-AUDITLOG-PR-C-SERVER-WATCH-2026-09-11.md item
 * 1, fix round 2 PACKET-PR-C1-FIX-ROUND2-GREPTILE-2026-09-11.md fix (a)).
 * Pure — fed the SAME InboxRow[] the 録音履歴 screen renders (deriveInboxRows,
 * inbox.ts:274), so this reads the exact fold a staffer already sees, never a
 * second guess at what "missing" means.
 *
 * A row is a candidate when it is 復元可能 or 失敗 (state 'recoverable' |
 * 'failed' — the two states 録音履歴 itself puts in 要対応) AND the assembler
 * has actually had its one shot at rescuing it: the assembler
 * (src/lib/recording/assembler.ts:1002) only attempts a rescue once the
 * NEWEST segment is at least ASSEMBLE_AFTER_MS old, so "started before the
 * last pass" is not enough — a session that ENDED less than assembleAfterMs
 * before the floor was skipped there as 'young' and deserves no verdict yet.
 * The session's end is `startedAt + durationSeconds * 1000` when the duration
 * is known, else `startedAt + SESSION_UNSETTLED_GRACE_MS` (inbox.ts's own
 * bound on an unsettled session — the honest guess when no duration exists).
 * A row is a candidate iff `sessionEnd + assembleAfterMs <= floor`, the
 * inclusive mirror of assembler.ts:1002's strict `newest > now - ASSEMBLE_
 * AFTER_MS` skip.
 *
 * ponytail: a budget-stopped assembler night can leave a folder unwalked
 * (its ring walk, assembler.ts), and a paused-then-resumed phone has no
 * hard upper bound — a row with no duration uses the inbox grace as its
 * honest bound rather than inventing a new ceiling. Fine at the current
 * allowlist rollout scale (tens of sessions); revisit if a folder is ever
 * found sitting unwalked past its grace at real volume.
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
