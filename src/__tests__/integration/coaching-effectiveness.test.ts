/**
 * Coaching effectiveness measurement — proves the three design corrections hold:
 * C1 difference-in-differences cancels regression-to-mean / store-wide shocks,
 * C3 shrinkage stops thin-sample flukes from topping real wins, and the
 * multi-horizon composite renormalizes honestly over available horizons.
 */
import {
  horizonEffect,
  shrink,
  effectivenessComposite,
  rankByEffectiveness,
  HORIZON_WEIGHTS,
  type HorizonInput,
} from '@/lib/karute/coaching/effectiveness'

const hi = (
  horizon: 30 | 90 | 180 | 365,
  treatedDelta: number,
  controlDelta: number,
  n: number,
): HorizonInput => ({ horizon, treatedDelta, controlDelta, n })

describe('C1 — difference-in-differences', () => {
  it('does NOT credit a store-wide shock (treated and control both up)', () => {
    // Everyone had a good quarter: treated +10, control +10. Raw pre/post would
    // read +10 "effective"; diff-in-diff reads ~0.
    const r = effectivenessComposite([hi(180, 10, 10, 1000)], 0)
    expect(r.composite).toBeCloseTo(0, 5)
  })

  it('DOES credit a lift the treated group got and the control did not', () => {
    // Well-sampled (shrinkage negligible) so this isolates the diff-in-diff.
    const r = effectivenessComposite([hi(180, 10, 2, 1_000_000)], 0)
    expect(r.composite).toBeCloseTo(8, 1)
  })

  it('horizonEffect is treated minus control', () => {
    expect(horizonEffect(hi(90, 12, 5, 20))).toBe(7)
    expect(horizonEffect(hi(90, 3, 9, 20))).toBe(-6)
  })
})

describe('C3 — empirical-Bayes shrinkage', () => {
  it('pulls a thin sample hard toward the prior', () => {
    expect(shrink(20, 3, 0)).toBeCloseTo((3 * 20) / (3 + 12), 5) // 4.0
  })
  it('barely moves a large sample', () => {
    expect(shrink(20, 100, 0)).toBeCloseTo((100 * 20) / 112, 5) // ~17.86
  })
  it('collapses to the prior with no data', () => {
    expect(shrink(999, 0, 3)).toBe(3)
  })

  it('a modest high-n win outranks an extreme low-n fluke', () => {
    // Fluke: raw effect 30 on n=3 → shrunk ~6. Real: raw 12 on n=40 → shrunk ~9.2.
    const fluke = effectivenessComposite([hi(180, 30, 0, 3)], 0)
    const real = effectivenessComposite([hi(180, 12, 0, 40)], 0)
    expect(real.composite!).toBeGreaterThan(fluke.composite!)
  })
})

describe('multi-horizon composite', () => {
  it('renormalizes weights over all four horizons (they sum to 1)', () => {
    const sum = HORIZON_WEIGHTS[30] + HORIZON_WEIGHTS[90] + HORIZON_WEIGHTS[180] + HORIZON_WEIGHTS[365]
    expect(sum).toBeCloseTo(1, 5)
    // Every horizon effect 10, well-sampled → composite 10.
    const r = effectivenessComposite(
      [hi(30, 15, 5, 1e6), hi(90, 15, 5, 1e6), hi(180, 15, 5, 1e6), hi(365, 15, 5, 1e6)],
      0,
    )
    expect(r.composite).toBeCloseTo(10, 1)
    expect(r.horizonsUsed).toEqual([30, 90, 180, 365])
    expect(r.confidence).toBe('mature')
  })

  it('renormalizes over only the horizons that have data (ramp-up)', () => {
    // 30d effect 0, 90d effect 10. Weights renorm to 0.1/0.35 and 0.25/0.35.
    const r = effectivenessComposite([hi(30, 5, 5, 1e6), hi(90, 15, 5, 1e6)], 0)
    expect(r.composite).toBeCloseTo(10 * (0.25 / 0.35), 1) // ~7.14
    expect(r.confidence).toBe('building')
  })

  it('a 30d-only tenant is scored on early signal, not a pretend-mature composite', () => {
    const r = effectivenessComposite([hi(30, 18, 6, 20)], 0)
    expect(r.horizonsUsed).toEqual([30])
    expect(r.confidence).toBe('early')
    expect(r.composite).not.toBeNull()
  })

  it('returns null with no data at all', () => {
    const r = effectivenessComposite([hi(30, 10, 0, 0)], 0)
    expect(r.composite).toBeNull()
    expect(r.confidence).toBe('none')
    expect(r.noveltySpike).toBeNull()
  })
})

describe('novelty-spike detection', () => {
  it('flags strong-early / faded-by-180d as a novelty spike', () => {
    const r = effectivenessComposite([hi(30, 10, 0, 1000), hi(180, 3, 0, 1000)], 0)
    expect(r.noveltySpike).toBe(true) // 3 < 10 * 0.5
  })
  it('does not flag a durable gain', () => {
    const r = effectivenessComposite([hi(30, 10, 0, 1000), hi(180, 8, 0, 1000)], 0)
    expect(r.noveltySpike).toBe(false)
  })
  it('cannot judge novelty before 180d lands', () => {
    const r = effectivenessComposite([hi(30, 10, 0, 1000), hi(90, 9, 0, 1000)], 0)
    expect(r.noveltySpike).toBeNull()
  })
})

describe('rankByEffectiveness', () => {
  it('ranks by composite, sinks no-data modules, breaks ties by sample size', () => {
    const ranked = rankByEffectiveness([
      { id: 'low', composite: 3, totalN: 50 },
      { id: 'none', composite: null, totalN: 999 },
      { id: 'high', composite: 9, totalN: 10 },
      { id: 'tie-small', composite: 9, totalN: 5 },
    ])
    expect(ranked.map((m) => m.id)).toEqual(['high', 'tie-small', 'low', 'none'])
  })
})
