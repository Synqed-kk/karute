// ⚖ PKT-S30 F2 (m6 + m15) — the store-days reducers: core's answer is the only thing committed.
import { applyClosureAdded, applyClosureRemoved, applySpecialOpenDays, type ClosureCore, type SpecialCore } from '@/business/lib/store-days-state'

const A: ClosureCore = { id: '11111111-1111-4111-8111-111111111111', date: '2026-11-04', reason: '棚卸し' }
const B: ClosureCore = { id: '22222222-2222-4222-8222-222222222222', date: '2026-11-20', reason: null }
const snap = (v: unknown) => JSON.stringify(v)

describe('F2 — applyClosureAdded', () => {
  it('commits core’s row, never the typed input, inserted in date order (P3-7)', () => {
    const typed = { date: '2026-11-09', reason: '入力した理由' }
    const core = { id: '33333333-3333-4333-8333-333333333333', date: '2026-11-10', reason: '核心の理由', store_id: 'x', created_at: 'y' } as ClosureCore
    const next = applyClosureAdded([A, B], { ok: true, value: core })!
    expect(next.map((r) => r.date)).toEqual(['2026-11-04', '2026-11-10', '2026-11-20'])
    expect(next[1]).toEqual({ id: core.id, date: '2026-11-10', reason: '核心の理由' })
    expect(snap(next)).not.toContain(typed.date)
    expect(snap(next)).not.toContain(typed.reason)
  })
  it('an earlier date lands first; a later one last', () => {
    const early = { id: 'e', date: '2026-11-01', reason: null }
    const late = { id: 'l', date: '2026-12-01', reason: null }
    expect(applyClosureAdded([A, B], { ok: true, value: early })!.map((r) => r.id)).toEqual(['e', A.id, B.id])
    expect(applyClosureAdded([A, B], { ok: true, value: late })!.map((r) => r.id)).toEqual([A.id, B.id, 'l'])
  })
  it('a failed write leaves prev byte-identical and the same reference', () => {
    const prev = [A, B]
    const before = snap(prev)
    const next = applyClosureAdded(prev, { ok: false })
    expect(next).toBe(prev)
    expect(snap(next)).toBe(before)
  })
})

describe('F2 — applyClosureRemoved', () => {
  it('drops exactly the removed id', () => {
    expect(applyClosureRemoved([A, B], { ok: true, value: A.id })).toEqual([B])
  })
  it('a failed write leaves prev byte-identical and the same reference', () => {
    const prev = [A, B]
    const before = snap(prev)
    const next = applyClosureRemoved(prev, { ok: false })
    expect(next).toBe(prev)
    expect(snap(next)).toBe(before)
  })
})

describe('F2 — applySpecialOpenDays', () => {
  const prev: SpecialCore[] = [{ date: '2026-11-05', open: '10:00', close: '19:00' }]
  it('core’s array replaces the list wholesale (nothing of prev survives unless core sent it)', () => {
    const core: SpecialCore[] = [{ date: '2026-11-12', open: '09:00', close: '18:00' }, { date: '2026-11-30', open: '11:00', close: '20:00' }]
    const next = applySpecialOpenDays(prev, { ok: true, value: core })!
    expect(next).toEqual(core)
    expect(next).not.toBe(core)
    expect(snap(next)).not.toContain('2026-11-05')
  })
  it('a failed write leaves prev byte-identical and the same reference', () => {
    const before = snap(prev)
    const next = applySpecialOpenDays(prev, { ok: false })
    expect(next).toBe(prev)
    expect(snap(next)).toBe(before)
  })
})

describe('PKT-S31 R5 — applySpecialOpenDays is the ONE home for order', () => {
  it('an unsorted core answer is committed sorted by date', () => {
    const next = applySpecialOpenDays(null, { ok: true, value: [{ date: '2026-12-01', open: '10:00', close: '12:00' }, { date: '2026-10-20', open: '10:00', close: '19:00' }] })
    expect(next!.map((d) => d.date)).toEqual(['2026-10-20', '2026-12-01'])
  })
})
