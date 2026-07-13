// ─────────────────────────────────────────────────────────────────────────
// Coaching effectiveness — the measurement core (v2 design §3)
// ─────────────────────────────────────────────────────────────────────────
// Pure functions. No I/O, no dates, no dependencies — every input is passed in,
// so the whole thing is unit-testable with zero live data. This is the part the
// adversarial review said had to be exactly right: a learning loop is only as
// good as its ability to tell a real coaching win from noise. Three corrections
// from that review are implemented here and proven by the test suite:
//
//   C1  difference-in-differences — score a horizon as (treated Δ − control Δ),
//       never a raw pre/post delta. A module is assigned BECAUSE a staffer dipped
//       below benchmark, so they rebound regardless (regression to the mean); and
//       store-wide/seasonal shocks move everyone. Subtracting an untreated
//       same-store/same-category control cancels BOTH — only a lift the treated
//       group got and the control didn't survives.
//   C3  empirical-Bayes shrinkage — pull a thinly-sampled score toward the
//       category prior so a 3-completion fluke can't outrank a 40-completion real
//       win. Replaces the spike's binary n≥3 gate with a confidence-scaled dial.
//   multi-horizon — 30/90/180/365-day composite (novelty spikes and slow-burn
//       winners get misclassified by a single window). Weights renormalize over
//       whichever horizons a tenant actually has yet (ramp-up), so a young tenant
//       is scored honestly on its early signal, not a pretend-mature composite.
//
// Consumes data the backend produces (module_completions + same-cohort control
// deltas — Anthony's contract, COACHING_V2_DESIGN §9); it does not fetch it.

/** The measurement horizons, in days. 180d is the primary signal (covers most
 *  Japanese salon business cycles); 365d validates across seasons. */
export const HORIZONS = [30, 90, 180, 365] as const
export type Horizon = (typeof HORIZONS)[number]

/** Default composite weights (v2 design). Renormalized over available horizons. */
export const HORIZON_WEIGHTS: Record<Horizon, number> = {
  30: 0.1,
  90: 0.25,
  180: 0.45,
  365: 0.2,
}

/** Shrinkage strength (C3): the pseudo-count of prior observations. A horizon
 *  needs ~this many real completions before its own signal outweighs the prior. */
export const SHRINK_K = 12

/** One horizon's raw measurement for one module. Deltas are in metric units
 *  (e.g. percentage points of closing rate) and MAY be negative. */
export interface HorizonInput {
  horizon: Horizon
  /** Mean metric change for staff who completed the module, over [t, t+H]. */
  treatedDelta: number
  /** Same-store/same-category staff who did NOT complete it, identical window.
   *  The C1 control arm — often the assigned-but-didn't-complete cohort. */
  controlDelta: number
  /** Completions contributing at this horizon (drives shrinkage confidence). */
  n: number
}

/** C1 — the difference-in-differences effect for one horizon, before shrinkage.
 *  This is the number that cancels regression-to-mean and store-wide shocks. */
export function horizonEffect(input: HorizonInput): number {
  return input.treatedDelta - input.controlDelta
}

/** C3 — shrink a raw score toward the category prior. n=0 collapses to the prior
 *  (no signal → assume typical); large n barely moves. */
export function shrink(
  rawScore: number,
  n: number,
  priorMean: number,
  k: number = SHRINK_K,
): number {
  if (n <= 0) return priorMean
  return (n * rawScore + k * priorMean) / (n + k)
}

export type Confidence = 'none' | 'early' | 'building' | 'mature'

export interface CompositeResult {
  /** Weighted, shrunk effect across available horizons — null when no horizon
   *  has data. In the same metric units as the inputs. */
  composite: number | null
  /** The shrunk per-horizon effect, for the horizons that had data. */
  byHorizon: Partial<Record<Horizon, number>>
  /** Which horizons contributed (n > 0). */
  horizonsUsed: Horizon[]
  /** Ramp-up state: 'early' = 30d only, 'building' = through 90/180, 'mature' =
   *  180d+ present. Surfaced in the owner UI so an early read is labeled as such. */
  confidence: Confidence
  /** True when the arc looks like a novelty spike: strong early, faded by 180d.
   *  Null when 180d isn't available yet to judge. */
  noveltySpike: boolean | null
}

/** Confidence from which horizons matured, not just how many samples. */
function confidenceFor(used: Horizon[]): Confidence {
  if (used.length === 0) return 'none'
  if (used.includes(180) || used.includes(365)) return 'mature'
  if (used.includes(90)) return 'building'
  return 'early'
}

/**
 * The multi-horizon effectiveness composite for one module.
 *
 * Each supplied horizon is scored by difference-in-differences (C1), shrunk
 * toward the prior (C3), then combined by the horizon weights renormalized over
 * exactly the horizons present (so a tenant with only 30/90-day data gets an
 * honest early composite, not one pretending 180/365 exist).
 */
export function effectivenessComposite(
  inputs: HorizonInput[],
  priorMean: number,
): CompositeResult {
  // Sanitize before summing: a NaN/undefined prior (e.g. 0/0 when a new vertical
  // has no peer stores to average) or an off-contract horizon (HORIZON_WEIGHTS
  // lookup → undefined → NaN) would otherwise poison the whole composite. Both
  // degrade to "no data" for that horizon rather than corrupting the result.
  const prior = Number.isFinite(priorMean) ? priorMean : 0
  const withData = inputs.filter(
    (i) => i.n > 0 && (HORIZONS as readonly number[]).includes(i.horizon),
  )
  if (withData.length === 0) {
    return { composite: null, byHorizon: {}, horizonsUsed: [], confidence: 'none', noveltySpike: null }
  }

  const byHorizon: Partial<Record<Horizon, number>> = {}
  for (const i of withData) {
    byHorizon[i.horizon] = shrink(horizonEffect(i), i.n, prior)
  }

  const used = withData
    .map((i) => i.horizon)
    .sort((a, b) => a - b) as Horizon[]

  const weightSum = used.reduce((s, h) => s + HORIZON_WEIGHTS[h], 0)
  const composite = used.reduce(
    (s, h) => s + (byHorizon[h] as number) * (HORIZON_WEIGHTS[h] / weightSum),
    0,
  )

  // Novelty: judged only once 180d has landed. Strong early (30d) that has
  // decayed to a fraction of itself by 180d is enthusiasm, not durable skill.
  let noveltySpike: boolean | null = null
  const early = byHorizon[30]
  const durable = byHorizon[180]
  if (durable !== undefined && early !== undefined) {
    noveltySpike = early > 0 && durable < early * 0.5
  }

  return { composite, byHorizon, horizonsUsed: used, confidence: confidenceFor(used), noveltySpike }
}

/** Rank modules for the weekly generation run (v2 design §3, C3): by the shrunk
 *  composite, so thin-sampled flukes can't top the list. Modules with no data
 *  sink to the bottom. Ties broken by total sample size (more evidence wins). */
export function rankByEffectiveness<T extends { composite: number | null; totalN: number }>(
  modules: T[],
): T[] {
  return [...modules].sort((a, b) => {
    // Sink not just null but any non-finite composite (NaN/±Infinity) to the
    // bottom, so a corrupted module can never rank by input order instead of value.
    const ac = Number.isFinite(a.composite as number) ? (a.composite as number) : -Infinity
    const bc = Number.isFinite(b.composite as number) ? (b.composite as number) : -Infinity
    if (ac !== bc) return bc - ac
    return b.totalN - a.totalN
  })
}
