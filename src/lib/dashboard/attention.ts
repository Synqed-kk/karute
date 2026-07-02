// Pure logic for the dashboard's AI sections (Liam-approved 3+2 design):
// 要注目 (which of today's customers deserve a prep card) and 推奨アクション
// (rebook suggestions from each customer's real visit rhythm). No IO.

export type AttentionBadge = 'lastOne' | 'packDone' | 'first' | 'comeback' | 'memo'

export interface AttentionCandidate {
  appointmentId: string
  clientId: string
  startIso: string
  firstTime: boolean
  /** Active-pack remaining, null when the customer holds no ACTIVE pack. */
  remaining: number | null
  size: number | null
  /** Ever held a pack (QR flag) — with no active pack ⇒ 券終了 comeback. */
  hadPack: boolean
  daysSinceLastVisit: number | null
  /** Cleaned booking request (QR plumbing stripped). */
  memo: string | null
}

export interface AttentionItem extends AttentionCandidate {
  badge: AttentionBadge
}

const BADGE_PRIORITY: AttentionBadge[] = ['lastOne', 'packDone', 'first', 'comeback', 'memo']

function badgeFor(c: AttentionCandidate, comebackDays: number): AttentionBadge | null {
  if (c.remaining !== null && c.remaining <= 1) return 'lastOne'
  if (c.hadPack && c.remaining === null) return 'packDone'
  if (c.firstTime) return 'first'
  if (c.daysSinceLastVisit !== null && c.daysSinceLastVisit >= comebackDays) return 'comeback'
  if (c.memo) return 'memo'
  return null
}

/** Today's noteworthy customers, hardest signals first, one card per customer
 *  (duplicate bookings collapse to the earliest), capped. Customers with
 *  nothing notable simply don't appear — the section earns its rows. */
export function pickAttention(
  candidates: AttentionCandidate[],
  opts: { max?: number; comebackDays?: number } = {},
): AttentionItem[] {
  const max = opts.max ?? 5
  const comebackDays = opts.comebackDays ?? 60
  const byClient = new Map<string, AttentionCandidate>()
  for (const c of [...candidates].sort((a, b) => a.startIso.localeCompare(b.startIso))) {
    if (!byClient.has(c.clientId)) byClient.set(c.clientId, c)
  }
  const items: AttentionItem[] = []
  for (const c of byClient.values()) {
    const badge = badgeFor(c, comebackDays)
    if (badge) items.push({ ...c, badge })
  }
  return items
    .sort(
      (a, b) =>
        BADGE_PRIORITY.indexOf(a.badge) - BADGE_PRIORITY.indexOf(b.badge) ||
        a.startIso.localeCompare(b.startIso),
    )
    .slice(0, max)
    .sort((a, b) => a.startIso.localeCompare(b.startIso))
}

/** Average days between visits, from the DATED series we actually have.
 *  Needs ≥3 dated visits for any confidence; clamped to a sane salon range. */
export function cycleDays(
  firstVisitIso: string | null,
  lastVisitIso: string | null,
  datedVisitCount: number,
): number | null {
  if (!firstVisitIso || !lastVisitIso || datedVisitCount < 3) return null
  const span =
    (new Date(lastVisitIso).getTime() - new Date(firstVisitIso).getTime()) / 86_400_000
  if (span <= 0) return null
  const cycle = Math.round(span / (datedVisitCount - 1))
  return cycle >= 2 && cycle <= 90 ? cycle : null
}

export interface RebookRow {
  clientId: string
  name: string
  remaining: number
  firstVisitIso: string | null
  lastVisitIso: string | null
  datedVisitCount: number
  nextAppointmentIso: string | null
}

export interface RebookSuggestion {
  clientId: string
  name: string
  remaining: number
  cycle: number
  /** yyyy-mm-dd the rhythm says they're due. */
  dueYmd: string
}

/** Pack holders with tickets left, NO next booking, and a readable rhythm —
 *  due (or overdue) within the horizon, soonest first. The Reserve-spike
 *  リブック提案, computed from real visit dates. */
export function rebookSuggestions(
  rows: RebookRow[],
  opts: { todayYmd: string; max?: number; horizonDays?: number },
): RebookSuggestion[] {
  const max = opts.max ?? 3
  const horizon = opts.horizonDays ?? 7
  const horizonMs =
    new Date(`${opts.todayYmd}T00:00:00Z`).getTime() + horizon * 86_400_000
  const out: RebookSuggestion[] = []
  for (const r of rows) {
    if (r.remaining <= 0 || r.nextAppointmentIso || !r.lastVisitIso) continue
    const cycle = cycleDays(r.firstVisitIso, r.lastVisitIso, r.datedVisitCount)
    if (!cycle) continue
    const dueMs = new Date(r.lastVisitIso).getTime() + cycle * 86_400_000
    if (dueMs > horizonMs) continue
    out.push({
      clientId: r.clientId,
      name: r.name,
      remaining: r.remaining,
      cycle,
      dueYmd: new Date(dueMs).toISOString().slice(0, 10),
    })
  }
  return out.sort((a, b) => a.dueYmd.localeCompare(b.dueYmd)).slice(0, max)
}

/** Deterministic per-badge fallback line — shown when the AI is unavailable,
 *  so the card never renders empty or fake. Japanese by design: the lines sit
 *  next to Japanese customer data and the AI generates Japanese too. */
export function fallbackLine(item: AttentionItem): string {
  switch (item.badge) {
    case 'lastOne':
      return '残り1回 — 施術後に次回券のご案内を'
    case 'packDone':
      return '回数券を使い切っての再訪 — 新しい券のご希望をうかがう'
    case 'first':
      return item.memo ? `初回。ご要望:${item.memo}` : '初回のご来店 — カウンセリングを丁寧に'
    case 'comeback':
      return `${item.daysSinceLastVisit}日ぶりのご来店 — 近況の確認から`
    case 'memo':
      return `ご要望:${item.memo ?? ''}`
  }
}
