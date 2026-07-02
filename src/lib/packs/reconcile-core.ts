// 未処理来店 detection — the forgot-to-record safety net's pure brain.
// (Conservation law: a visit that happened but never touched the ledger makes
// 残回数 confidently WRONG everywhere. This finds those visits so the
// dashboard can offer この日に消化 / 来店なし one-taps.)
//
// Pure + Jest-safe: no imports from next/*, no clock reads — the caller
// supplies todayJst. The loader (reconcile.ts) gathers inputs.

export interface ReconcileAppointment {
  id: string
  customerId: string
  /** JST calendar day (yyyy-mm-dd) of the visit. */
  visitDayJst: string
  isCancelled: boolean
  /** Sheet-import historical records (notes tag) — NEVER flagged: they're
   *  imported history, not unprocessed work; their redemptions are pack-level
   *  synthetic rows without per-appointment links by design. */
  isImport: boolean
  /** A karute record exists for this appointment (appointment.karute_record_id). */
  hasKarute: boolean
}

export interface UnprocessedVisit {
  customerId: string
  appointmentId: string
  visitDay: string
  /** 'unrecorded' = no karute AND no redemption (記録なし — the full miss);
   *  'unredeemed' = karute exists but the pack wasn't ticked (消化のみ未処理). */
  kind: 'unrecorded' | 'unredeemed'
}

export interface FindUnprocessedInput {
  /** Active counted-pack usage per customer — only holders with remaining > 0
   *  can consume, so only they reconcile. */
  holders: ReadonlyMap<string, { remaining: number }>
  lifecycles: ReadonlyMap<string, { status: 'active' | 'graduated' | 'lost' }>
  appointments: readonly ReconcileAppointment[]
  /** Redemptions in (and slightly around) the window. */
  redemptions: readonly {
    customerId: string
    appointmentId: string | null
    redeemedOn: string // yyyy-mm-dd
  }[]
  /** 来店なし answers — `${customerId}|${visitDay}` keys. */
  dismissals: ReadonlySet<string>
  /** JST today (yyyy-mm-dd). Today's visits get same-day grace — staff may
   *  still be mid-flow; only days strictly before today are flagged. */
  todayJst: string
  lookbackDays?: number
  cap?: number
}

export interface ReconcileResult {
  visits: UnprocessedVisit[]
  /** How many qualifying visits were cut by the cap (the strip says so —
   *  silent truncation reads as "covered everything"). */
  truncated: number
}

export function findUnprocessedVisits(i: FindUnprocessedInput): ReconcileResult {
  const lookback = i.lookbackDays ?? 7
  const cap = i.cap ?? 10
  // Window: [today - lookback, today) — string compare is safe on yyyy-mm-dd.
  const floor = shiftDay(i.todayJst, -lookback)

  // Redemption coverage: by explicit appointment link, and by customer+day
  // (manual check-offs and the stop-dialog path may not carry the link).
  const redeemedAppointmentIds = new Set<string>()
  const redeemedDays = new Set<string>()
  for (const r of i.redemptions) {
    if (r.appointmentId) redeemedAppointmentIds.add(r.appointmentId)
    redeemedDays.add(`${r.customerId}|${r.redeemedOn}`)
  }

  const out: UnprocessedVisit[] = []
  for (const a of i.appointments) {
    if (a.isCancelled || a.isImport) continue
    if (a.visitDayJst < floor || a.visitDayJst > i.todayJst) continue
    // Same-day grace applies ONLY to full misses (no karute yet — staff may be
    // mid-flow). A visit recorded today with no burn is a finished flow whose
    // 消化 toggle was skipped → flag it now so the dashboard's やること catches
    // it the same day instead of tomorrow.
    if (a.visitDayJst === i.todayJst && !a.hasKarute) continue
    const holder = i.holders.get(a.customerId)
    if (!holder || holder.remaining <= 0) continue
    const lc = i.lifecycles.get(a.customerId)?.status
    if (lc === 'graduated' || lc === 'lost') continue
    if (i.dismissals.has(`${a.customerId}|${a.visitDayJst}`)) continue
    const redeemed =
      redeemedAppointmentIds.has(a.id) ||
      redeemedDays.has(`${a.customerId}|${a.visitDayJst}`)
    if (redeemed) continue
    out.push({
      customerId: a.customerId,
      appointmentId: a.id,
      visitDay: a.visitDayJst,
      kind: a.hasKarute ? 'unredeemed' : 'unrecorded',
    })
  }
  // Oldest first — the longest-unprocessed visit is the most urgent to fix
  // before memories fade.
  out.sort((x, y) => x.visitDay.localeCompare(y.visitDay))
  return { visits: out.slice(0, cap), truncated: Math.max(0, out.length - cap) }
}

/** yyyy-mm-dd ± days, pure string/UTC math (no TZ surprises). */
export function shiftDay(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}
