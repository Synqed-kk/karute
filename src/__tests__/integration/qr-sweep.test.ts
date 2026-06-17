/**
 * The cancel-sweep planner is the only place a booking gets cancelled, and a
 * wrong cancel hides a real booking from every screen. These pin EVERY guard:
 * QR-owned + SCHEDULED only, suspect-day skip (the silent-empty / partial-fetch
 * mass-cancel kill shots), the per-run cap, matched-row exclusion, and the
 * duplicate-orphan retire.
 */
import type { Appointment, AppointmentStatus, AppointmentSource } from '@synqed-kk/client'
import { planQrCancellations, isSweepable, type SweepDay } from '@/lib/sync/qr-sweep'

const DAY = '2026-06-17'
// 12:00 and 18:00 JST on DAY — both inside the day's [00:00,23:59.999]+09:00 window.
const T_NOON = '2026-06-17T03:00:00Z'
const T_EVE = '2026-06-17T09:00:00Z'

function appt(p: {
  id: string
  notes?: string | null
  status?: AppointmentStatus
  source?: AppointmentSource
  starts_at?: string
}): Appointment {
  return {
    id: p.id,
    business_id: 'biz',
    customer_id: 'c',
    staff_id: 's',
    starts_at: p.starts_at ?? T_NOON,
    ends_at: p.starts_at ?? T_NOON,
    duration_minutes: 60,
    title: 'x',
    notes: p.notes ?? `QR #${p.id} | memo`,
    status: p.status ?? 'SCHEDULED',
    source: p.source ?? 'QUICKRESERVE',
    external_refs: {},
    cancelled_at: null,
    created_at: T_NOON,
    updated_at: T_NOON,
  } as Appointment
}

function day(liveIds: string[], reservationsCount?: number): SweepDay {
  return { dateStr: DAY, liveQrIds: new Set(liveIds), reservationsCount: reservationsCount ?? liveIds.length }
}

const noMatched = new Set<string>()

describe('isSweepable', () => {
  it('only QR-owned + SCHEDULED rows are sweepable', () => {
    expect(isSweepable(appt({ id: '1' }))).toBe(true) // QUICKRESERVE + QR notes + SCHEDULED
    expect(isSweepable(appt({ id: '2', source: 'MANUAL', notes: 'QR #2 | x' }))).toBe(true) // back-compat
    expect(isSweepable(appt({ id: '3', source: 'MANUAL', notes: 'walk-in' }))).toBe(false) // real manual
    expect(isSweepable(appt({ id: '4', status: 'IN_PROGRESS' }))).toBe(false)
    expect(isSweepable(appt({ id: '5', status: 'COMPLETED' }))).toBe(false)
    expect(isSweepable(appt({ id: '6', status: 'CANCELLED' }))).toBe(false)
  })
})

describe('planQrCancellations', () => {
  it('cancels a QR-owned row whose reservation vanished from the live set', () => {
    const all = [appt({ id: '100' }), appt({ id: '200', starts_at: T_EVE })]
    // 100 still live, 200 gone.
    const plan = planQrCancellations({ allExisting: all, sweepDays: [day(['100'])], matchedIds: noMatched, staleDuplicateIds: [] })
    expect(plan.toCancel).toEqual(['200'])
    expect(plan.capExceeded).toBe(false)
  })

  it('never cancels a manual booking (no QR prefix), even if absent from live set', () => {
    const all = [appt({ id: 'walkin', source: 'MANUAL', notes: '飛び込み 肩こり' })]
    const plan = planQrCancellations({ allExisting: all, sweepDays: [day([])], matchedIds: noMatched, staleDuplicateIds: [] })
    expect(plan.toCancel).toEqual([])
  })

  it('never cancels IN_PROGRESS / COMPLETED / already-CANCELLED rows', () => {
    const all = [
      appt({ id: 'a', status: 'IN_PROGRESS' }),
      appt({ id: 'b', status: 'COMPLETED', starts_at: T_EVE }),
      appt({ id: 'c', status: 'CANCELLED', starts_at: T_EVE }),
    ]
    const plan = planQrCancellations({ allExisting: all, sweepDays: [day([])], matchedIds: noMatched, staleDuplicateIds: [] })
    expect(plan.toCancel).toEqual([])
  })

  it('SKIPS a silently-empty day (reservationsCount 0 but rows exist) — the mass-cancel kill shot', () => {
    const all = [appt({ id: '1' }), appt({ id: '2', starts_at: T_EVE })]
    const plan = planQrCancellations({ allExisting: all, sweepDays: [day([], 0)], matchedIds: noMatched, staleDuplicateIds: [] })
    expect(plan.toCancel).toEqual([])
    expect(plan.skippedDays).toEqual([{ dateStr: DAY, reason: 'empty-but-populated' }])
  })

  it('SKIPS a partial day (live set < 50% of existing rows) — the truncated-fetch case', () => {
    // 4 existing rows, QR only returned 1 live id → suspicious partial fetch.
    const all = ['1', '2', '3', '4'].map((id, i) => appt({ id, starts_at: i < 2 ? T_NOON : T_EVE }))
    const plan = planQrCancellations({ allExisting: all, sweepDays: [day(['1'], 1)], matchedIds: noMatched, staleDuplicateIds: [] })
    expect(plan.toCancel).toEqual([])
    expect(plan.skippedDays).toEqual([{ dateStr: DAY, reason: 'partial-suspect' }])
  })

  it('PER-RUN CAP: aborts (cancels nothing) when a run would cancel too many', () => {
    const all = ['1', '2', '3', '4'].map((id) => appt({ id }))
    // All 4 live-ids present so the partial gate passes; but maxCancels=1 and 2 vanished.
    const plan = planQrCancellations({
      allExisting: all,
      sweepDays: [day(['1', '2'])], // 1,2 live; 3,4 gone → 2 cancellations
      matchedIds: noMatched,
      staleDuplicateIds: [],
      maxCancels: 1,
    })
    expect(plan.capExceeded).toBe(true)
    expect(plan.toCancel).toEqual([])
    expect(plan.cancelCount).toBe(0)
  })

  it('excludes rows matched (updated/created) this run', () => {
    const all = [appt({ id: '1' }), appt({ id: '2', starts_at: T_EVE })]
    // 2 isn't in the live set, but it was matched this run → not a cancel candidate.
    const plan = planQrCancellations({ allExisting: all, sweepDays: [day(['1'])], matchedIds: new Set(['2']), staleDuplicateIds: [] })
    expect(plan.toCancel).toEqual([])
  })

  it('cancels a stale duplicate (orphan from an earlier move) if still sweepable', () => {
    // Two rows share QR #327563 (a move that left an orphan); distinct appt ids.
    const all = [
      appt({ id: 'live-uuid', notes: 'QR #327563 | x' }),
      appt({ id: 'orphan-uuid', notes: 'QR #327563 | x', starts_at: T_EVE }),
    ]
    const plan = planQrCancellations({
      allExisting: all,
      sweepDays: [day(['327563'])], // the shared QR id is live, so the day diff cancels neither
      matchedIds: noMatched,
      staleDuplicateIds: ['orphan-uuid'],
    })
    expect(plan.toCancel).toEqual(['orphan-uuid'])
  })

  it('never judges a day that was not fetched (absent from sweepDays)', () => {
    const all = [appt({ id: '1' }), appt({ id: '2', starts_at: T_EVE })]
    // No sweepDays at all → nothing is a candidate (an errored/continued day).
    const plan = planQrCancellations({ allExisting: all, sweepDays: [], matchedIds: noMatched, staleDuplicateIds: [] })
    expect(plan.toCancel).toEqual([])
  })
})
