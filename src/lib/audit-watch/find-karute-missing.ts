/**
 * 監査ログ round 2, PR C — subject 1: which recording sessions never became a
 * karute and never will (PACKET-AUDITLOG-PR-C-SERVER-WATCH-2026-09-11.md item
 * 1). Pure — fed the SAME InboxRow[] the 録音履歴 screen renders (deriveInboxRows,
 * inbox.ts:274), so this reads the exact fold a staffer already sees, never a
 * second guess at what "missing" means.
 *
 * A row is a candidate when it is 復元可能 or 失敗 (state 'recoverable' |
 * 'failed' — the two states 録音履歴 itself puts in 要対応) AND it is older
 * than the last completed nightly assembler pass: the assembler (build 23
 * slice ③, /api/assemble) rescues a stranded take into 'recoverable' every
 * night at 03:07 JST, so a row that age has already had its one automatic
 * rescue attempt and is now a genuine miss, not merely "the assembler hasn't
 * run yet tonight".
 */
import type { InboxRow } from '@/lib/recordings/inbox'

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
}): InboxRow[] {
  const { rows, now, lastAssemblerPassAt: floor } = input
  return rows.filter(
    (r) =>
      (r.state === 'recoverable' || r.state === 'failed') &&
      r.startedAt <= now &&
      r.startedAt < floor,
  )
}
