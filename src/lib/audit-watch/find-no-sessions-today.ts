/**
 * 監査ログ round 2, PR C — Group B d5: which staffer usually records but
 * produced no session today (PKT-GROUP-B-SERVER-MINT-HONESTY-2026-09-12.md
 * d5). Pure — no I/O, no wall clock — in the shape of find-karute-missing.ts
 * next door.
 *
 * WHY PER STAFFER, NOT PER BUSINESS. On 9/9 three phones minted fine (12:07 ·
 * 14:05 · 19:00) while ONE staffer's phone minted nothing for two days. A
 * business-level "zero sessions today" would never have fired — the salon
 * recorded plenty, just not through that one phone. So the gate is per
 * staffer (in the CORE staff id space): a staffer who (a) has at least one
 * KEPT appointment today, (b) minted at least one session in the previous 7
 * days (proof they are a recorder, not merely rostered), and (c) minted ZERO
 * sessions today, is flagged.
 *
 * ⚠ TWO ID SPACES (session-mint.ts:156-160): `recording_sessions.staff_id` is
 * the AUTH/PROFILE id on a resolved-identity mint but the CORE STAFF id on
 * the appointment-fallback mint, while `appointments.staff_id` is always the
 * core staff id. `staffIdToCoreId` is the caller's normalize-to-core-id map
 * (both `id → id` and `user_id → id`, synqed.staff.list) — a session or
 * appointment whose staff id maps to NOTHING is ignored here, never given an
 * invented join.
 *
 * THIS ROW IS A CHECK, NEVER A DIAGNOSIS (design law §1 Layer A) — it says
 * "this staffer, who usually records, produced no session today", not WHY
 * (a legitimate day off with no bookings is already excluded by gate (a); a
 * customer who declined consent is a real but accepted false-positive class
 * this finder does not distinguish — see the packet's CONSENT GATE note:
 * skipped, no bulk per-customer consent read exists to build it from).
 */
import { ymdInJst } from '@/lib/date/jst'
import type { InboxServerSession } from '@/lib/recordings/inbox'

const DAY_MS = 24 * 60 * 60 * 1000
const LOOKBACK_MS = 7 * DAY_MS

export interface NoSessionsTodayResult {
  day: string
  /** Core staff ids, sorted — the flagged staffers only. */
  staff_ids: string[]
  /** Sum of today's kept appointments, over the flagged staffers only. */
  kept_appointments: number
  /** Always 0 by construction — gate (c) is exactly "zero sessions today". */
  sessions_today: 0
  /** Sum of the flagged staffers' sessions in the previous 7 days. */
  sessions_prev_7d: number
}

export function findNoSessionsToday(input: {
  /** The SAME probeIncomplete-filtered session set the caller already built
   *  for findKaruteMissing (run.ts) — never the raw, unfiltered read: a
   *  truncated page could otherwise undercount a real staffer's sessions and
   *  manufacture a false "zero today". */
  sessions: readonly Pick<InboxServerSession, 'staffId' | 'createdAt'>[]
  /** Today's appointments, already filtered to !isTerminalStatus (kept). */
  appointments: readonly { staff_id: string }[]
  /** Normalize-to-core-id map: both `id → id` and `user_id → id`. */
  staffIdToCoreId: ReadonlyMap<string, string>
  /** Epoch ms — the injected clock, never the wall clock. */
  now: number
  /** JST midnight of the day being evaluated, as a Date. */
  todayStart: Date
}): NoSessionsTodayResult | null {
  const { sessions, appointments, staffIdToCoreId, now, todayStart } = input
  const todayStartMs = todayStart.getTime()
  const lookbackStartMs = todayStartMs - LOOKBACK_MS

  // (a) kept appointments today, per core staffer.
  const keptTodayByStaffer = new Map<string, number>()
  for (const a of appointments) {
    const coreId = staffIdToCoreId.get(a.staff_id)
    if (!coreId) continue // never invent a join — an unmapped id is ignored
    keptTodayByStaffer.set(coreId, (keptTodayByStaffer.get(coreId) ?? 0) + 1)
  }

  // (b) sessions in the previous 7 days, and (c) sessions today — both per
  // core staffer, normalizing whichever id space each session's staffId is
  // actually in.
  const sessionsTodayByStaffer = new Set<string>()
  const sessionsPrev7dByStaffer = new Map<string, number>()
  for (const s of sessions) {
    if (!s.staffId) continue
    const coreId = staffIdToCoreId.get(s.staffId)
    if (!coreId) continue // sessions whose staffId maps to nothing are ignored
    const at = Date.parse(s.createdAt)
    if (Number.isNaN(at)) continue
    if (at >= todayStartMs && at <= now) {
      sessionsTodayByStaffer.add(coreId)
    } else if (at >= lookbackStartMs && at < todayStartMs) {
      sessionsPrev7dByStaffer.set(coreId, (sessionsPrev7dByStaffer.get(coreId) ?? 0) + 1)
    }
  }

  const flagged: string[] = []
  for (const [coreId, keptCount] of keptTodayByStaffer) {
    if (keptCount < 1) continue
    if (!sessionsPrev7dByStaffer.has(coreId)) continue // never recorded — silent
    if (sessionsTodayByStaffer.has(coreId)) continue // recorded today — silent
    flagged.push(coreId)
  }
  if (flagged.length === 0) return null
  flagged.sort()

  return {
    day: ymdInJst(todayStart),
    staff_ids: flagged,
    kept_appointments: flagged.reduce((n, id) => n + (keptTodayByStaffer.get(id) ?? 0), 0),
    sessions_today: 0,
    sessions_prev_7d: flagged.reduce((n, id) => n + (sessionsPrev7dByStaffer.get(id) ?? 0), 0),
  }
}
