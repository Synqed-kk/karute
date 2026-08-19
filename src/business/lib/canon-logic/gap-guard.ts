// CANON-LOGIC — スキマガード placement engine, ported from gap-guard-engine.js.
//
// That file is already pure (its own header: 「純粋関数のみ。DOM・時計・乱数に
// 触らない」), so this is a near-verbatim TypeScript port: same names, same
// arithmetic, same lexicographic key, same verdicts. Only the module shape
// changed (UMD → ES module) and the types were written down.
//
// WHAT IT DECIDES. Given a free pocket and a placement inside it, is putting a
// booking there a refusal, an unavoidable loss, or fine? The key is compared
// lexicographically:
//
//   [protectedCapacityLoss, otherRepertoireLossCount, deadResidueMin, salvageResidueMin]
//
// · protectedCapacityLoss — how many mutually non-overlapping 新規-length
//   windows this placement destroys. First term, and the ONE term that is never
//   masked by a wall or lead-time exemption: a lost 90-minute new-client window
//   is lost however tidy the leftovers look.
// · otherRepertoireLossCount — menu durations the pocket could host before and
//   neither residue can host after.
// · deadResidueMin / salvageResidueMin — leftover minutes nothing can use, and
//   leftover minutes a スキマ枠 offer could still sell.
//
// A placement is REFUSED when some other start in the same pocket has a
// strictly smaller key; DEGRADED when the loss is unavoidable everywhere (log
// it, do not block); OK/EXEMPT when the key is all zeros. Pockets are never
// compared against each other.

const LATTICE_STEP_MIN = 5

export interface GuardService {
  name: string
  dur: number
}

export interface GuardPocket {
  s: number
  e: number
  /** Which sides of this pocket are a hard boundary (opening, closing, a break).
   *  A residue against a wall was never sellable, so it is not counted a loss. */
  walls?: { left?: string | null; right?: string | null }
}

export interface GuardPlacement {
  start: number
  dur: number
}

export interface GuardContext {
  /** Minutes-from-midnight "now", for the lead-time exemption. */
  now?: number
  /** Does the real world publish a protected window starting here? */
  protectedWindowFeasible?: (start: number, dur: number) => boolean
  /** Can this existing booking actually occupy the whole span? */
  placementFeasible?: (start: number, dur: number) => boolean
}

export interface GuardConfig {
  services: GuardService[]
  newClientSessionMin?: number
  protectedDurationMin?: number | null
  protectedLabel?: string
  gapFillMinMin?: number
  blockStepMin?: number
  leadTimeMin?: number
  mode?: 'standard' | 'strict'
}

export type GuardVerdict = 'ok' | 'exempt' | 'degraded' | 'refuse'

export interface GuardReason {
  code: 'R-REP' | 'R-DEAD' | 'R-SALV' | 'R-UNAVAILABLE' | 'EXEMPT' | 'DEGRADED'
  params: Record<string, unknown>
  ackAllowed?: boolean
}

export interface GuardResult {
  verdict: GuardVerdict
  reason?: GuardReason
  alternatives: number[]
  alternativeKind: 'safe' | 'least-loss' | null
  protectedCapacityBefore: number
  protectedCapacityAfter: number
  protectedCapacityLoss: number
  protectedWindowsBefore: number[]
  protectedWindowsAfter: number[]
  leastLossStart?: number
}

function uniqueSorted(nums: Array<number | undefined>): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const n of nums) {
    if (typeof n === 'number' && !seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out.sort((a, b) => a - b)
}

export function createGapGuard(config: GuardConfig) {
  const services = Array.isArray(config.services) ? config.services : []
  const newClientSessionMin = config.newClientSessionMin
  const hasProtectedDuration = Object.prototype.hasOwnProperty.call(config, 'protectedDurationMin')
  const protectedDurationMin = hasProtectedDuration ? config.protectedDurationMin : newClientSessionMin
  const protectedLabel = config.protectedLabel || '新規'
  const gapFillMinMin = typeof config.gapFillMinMin === 'number' ? config.gapFillMinMin : 0
  const leadTimeMin = typeof config.leadTimeMin === 'number' ? config.leadTimeMin : 0
  const mode = config.mode === 'strict' ? 'strict' : 'standard'

  const serviceDurationSet = uniqueSorted(services.map((s) => s.dur))
  const durations = uniqueSorted(
    serviceDurationSet.concat(typeof protectedDurationMin === 'number' ? [protectedDurationMin] : []),
  )
  /** The protected duration carries its own capacity term, so leaving it in the
   *  binary repertoire term too would double-count the same loss. */
  const otherDurations = serviceDurationSet.filter((d) => d !== protectedDurationMin)

  const durationSet = () => durations.slice()

  /** Unbounded-knapsack DP on the 5-minute lattice: can `min` be made exactly
   *  from the duration multiset? Zero minutes is the empty set — always true. */
  function fillableExactly(min: number): boolean {
    if (min === 0) return true
    if (min < 0 || min % LATTICE_STEP_MIN !== 0 || durations.length === 0) return false
    const steps = min / LATTICE_STEP_MIN
    const coins = durations.map((d) => d / LATTICE_STEP_MIN)
    const dp: boolean[] = new Array(steps + 1).fill(false)
    dp[0] = true
    for (let i = 1; i <= steps; i += 1) {
      for (const c of coins) {
        if (c <= i && dp[i - c]) { dp[i] = true; break }
      }
    }
    return dp[steps]
  }

  /** Largest-first greedy, deliberately without backtracking — so it can return
   *  null where `fillableExactly` says true (105 = 45+60, but taking 90 first
   *  jams). Callers treat null as "show it as its own offer". */
  function fillDecomposition(min: number): number[] | null {
    if (min === 0) return []
    if (min < 0 || min % LATTICE_STEP_MIN !== 0 || durations.length === 0) return null
    const desc = durations.slice().sort((a, b) => b - a)
    let remaining = min
    const picks: number[] = []
    while (remaining > 0) {
      const pick = desc.find((d) => d <= remaining)
      if (pick === undefined) return null
      picks.push(pick)
      remaining -= pick
    }
    return picks
  }

  const hostableFrom = (set: number[], len: number) => set.filter((d) => d <= len)
  const hostable = (len: number) => hostableFrom(durations, len)

  /** One residue's classification. Exactly fillable is first-class (the normal
   *  sell layer prices it — not a loss at all); ≥ the スキマ枠 dial is salvage;
   *  below it is honest dead time. An exempt side counts as none of them. */
  function residueClass(len: number, exempt: boolean): { dead: number; salvage: number } {
    if (len <= 0 || exempt) return { dead: 0, salvage: 0 }
    if (fillableExactly(len)) return { dead: 0, salvage: 0 }
    if (gapFillMinMin > 0 && len >= gapFillMinMin) return { dead: 0, salvage: len }
    return { dead: len, salvage: 0 }
  }

  function repertoireLossSet(pocketLen: number, maskedLenL: number, maskedLenR: number): number[] {
    if (maskedLenL <= 0 && maskedLenR <= 0) return []
    const base = hostableFrom(otherDurations, pocketLen)
    const union = new Set<number>([
      ...hostableFrom(otherDurations, maskedLenL),
      ...hostableFrom(otherDurations, maskedLenR),
    ])
    return base.filter((d) => !union.has(d))
  }

  const overlaps = (aStart: number, aDur: number, bStart: number, bDur: number) =>
    aStart < bStart + bDur && bStart < aStart + aDur

  /** Equal-length interval scheduling: earliest-finish greedy gives the maximum
   *  number of mutually non-overlapping protected windows. */
  function protectedWindows(pocket: GuardPocket, placement: GuardPlacement | null, ctx: GuardContext): number[] {
    if (typeof protectedDurationMin !== 'number' || protectedDurationMin <= 0) return []
    const feasible = typeof ctx.protectedWindowFeasible === 'function' ? ctx.protectedWindowFeasible : null
    const firstStart = feasible ? Math.ceil(pocket.s / LATTICE_STEP_MIN) * LATTICE_STEP_MIN : pocket.s
    const selected: number[] = []
    let lastEnd = -Infinity
    for (let s = firstStart; s + protectedDurationMin <= pocket.e; s += LATTICE_STEP_MIN) {
      if (placement && overlaps(s, protectedDurationMin, placement.start, placement.dur)) continue
      if (feasible && !feasible(s, protectedDurationMin)) continue
      if (s < lastEnd) continue
      selected.push(s)
      lastEnd = s + protectedDurationMin
    }
    return selected
  }

  function protectedCapacity(pocket: GuardPocket, placement: GuardPlacement | null, ctx: GuardContext = {}) {
    const before = protectedWindows(pocket, null, ctx)
    const after = placement ? protectedWindows(pocket, placement, ctx) : before.slice()
    return {
      before: before.length,
      after: after.length,
      loss: Math.max(0, before.length - after.length),
      beforeStarts: before,
      afterStarts: after,
    }
  }

  const wallExempt = (side: 'left' | 'right', len: number, pocket: GuardPocket) =>
    len > 0 && Boolean(pocket.walls && pocket.walls[side])

  const leadTimeExempt = (len: number, residueEnd: number, ctx: GuardContext) =>
    len > 0 && typeof ctx.now === 'number' && residueEnd <= ctx.now + leadTimeMin

  interface CandidateInfo {
    key: number[]
    protectedCapacityBefore: number
    protectedCapacityAfter: number
    protectedWindowsBefore: number[]
    protectedWindowsAfter: number[]
    lossSet: number[]
    exemptionApplied: boolean
    exemptSide: 'left' | 'right' | null
    wallSide: 'left' | 'right' | null
  }

  function candidateKey(pocket: GuardPocket, start: number, dur: number, ctx: GuardContext, protectedBefore?: number[]): CandidateInfo {
    const placement = { start, dur }
    const beforeWindows = protectedBefore || protectedWindows(pocket, null, ctx)
    const afterWindows = protectedWindows(pocket, placement, ctx)
    const protectedLoss = Math.max(0, beforeWindows.length - afterWindows.length)
    const lenL = start - pocket.s
    const lenR = pocket.e - (start + dur)
    const exemptL = wallExempt('left', lenL, pocket) || leadTimeExempt(lenL, start, ctx)
    const exemptR = wallExempt('right', lenR, pocket) || leadTimeExempt(lenR, pocket.e, ctx)
    const clsL = residueClass(lenL, exemptL)
    const clsR = residueClass(lenR, exemptR)
    const lossSet = repertoireLossSet(pocket.e - pocket.s, exemptL ? 0 : lenL, exemptR ? 0 : lenR)
    return {
      key: [protectedLoss, lossSet.length, clsL.dead + clsR.dead, clsL.salvage + clsR.salvage],
      protectedCapacityBefore: beforeWindows.length,
      protectedCapacityAfter: afterWindows.length,
      protectedWindowsBefore: beforeWindows.slice(),
      protectedWindowsAfter: afterWindows,
      lossSet,
      exemptionApplied: (exemptL && lenL > 0) || (exemptR && lenR > 0),
      exemptSide: exemptL ? 'left' : exemptR ? 'right' : null,
      wallSide: wallExempt('left', lenL, pocket) ? 'left' : wallExempt('right', lenR, pocket) ? 'right' : null,
    }
  }

  function compareKeys(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i] === undefined || b[i] === undefined) return a.length - b.length
      if (a[i] !== b[i]) return a[i] - b[i]
    }
    return 0
  }

  const placementIsFeasible = (start: number, dur: number, ctx: GuardContext) =>
    typeof ctx.placementFeasible === 'function' ? Boolean(ctx.placementFeasible(start, dur)) : true

  function candidateStarts(pocket: GuardPocket, dur: number, ctx: GuardContext): number[] {
    const hasCallback = typeof ctx.placementFeasible === 'function'
    const firstStart = hasCallback ? Math.ceil(pocket.s / LATTICE_STEP_MIN) * LATTICE_STEP_MIN : pocket.s
    const starts: number[] = []
    for (let s = firstStart; s + dur <= pocket.e; s += LATTICE_STEP_MIN) {
      if (placementIsFeasible(s, dur, ctx)) starts.push(s)
    }
    return starts
  }

  const isZeroKey = (key: number[]) => key.every((n) => n === 0)

  function safeStarts(pocket: GuardPocket, dur: number, ctx: GuardContext = {}): number[] {
    const protectedBefore = protectedWindows(pocket, null, ctx)
    return candidateStarts(pocket, dur, ctx).filter((start) =>
      isZeroKey(candidateKey(pocket, start, dur, ctx, protectedBefore).key),
    )
  }

  /** Choices come from the feasible pocket-best key, never from safeStarts(): a
   *  pocket can have no zero-loss start and still have a strictly safer one. */
  function nearestBestAlternatives(
    candidateInfos: Array<{ start: number; info: CandidateInfo }>,
    attemptedStart: number,
    attemptedKey: number[],
    bestKey: number[] | null,
    requireStrictlyBetter: boolean,
  ): { starts: number[]; kind: 'safe' | 'least-loss' | null } {
    if (!bestKey || (requireStrictlyBetter && compareKeys(bestKey, attemptedKey) >= 0)) {
      return { starts: [], kind: null }
    }
    const bestStarts = candidateInfos
      .filter((c) => compareKeys(c.info.key, bestKey) === 0)
      .map((c) => c.start)
    let before: number | null = null
    let after: number | null = null
    for (const s of bestStarts) {
      if (s < attemptedStart && (before === null || s > before)) before = s
      if (s > attemptedStart && (after === null || s < after)) after = s
    }
    const out: number[] = []
    if (before !== null) out.push(before)
    if (after !== null) out.push(after)
    return { starts: out, kind: out.length ? (isZeroKey(bestKey) ? 'safe' : 'least-loss') : null }
  }

  function repLabel(lossSet: number[]): string {
    const maxLost = lossSet.slice().sort((a, b) => b - a)[0]
    const svc = services.find((s) => s.dur === maxLost)
    return svc ? svc.name : `${maxLost}分`
  }

  function reasonForKey(key: number[], lossSet: number[], info: CandidateInfo): GuardReason {
    if (key[0] > 0) {
      return {
        code: 'R-REP',
        params: {
          label: `${protectedLabel}（${protectedDurationMin}分）`,
          capacityBefore: info.protectedCapacityBefore,
          capacityAfter: info.protectedCapacityAfter,
          capacityLost: key[0],
        },
      }
    }
    if (key[1] > 0) return { code: 'R-REP', params: { label: repLabel(lossSet) } }
    if (key[2] > 0) return { code: 'R-DEAD', params: { n: key[2] } }
    return { code: 'R-SALV', params: { n: key[3] } }
  }

  function evaluate(pocket: GuardPocket, placement: GuardPlacement, ctx: GuardContext = {}): GuardResult {
    const { start, dur } = placement
    const protectedBefore = protectedWindows(pocket, null, ctx)
    const attempted = candidateKey(pocket, start, dur, ctx, protectedBefore)
    const attemptedFeasible =
      start >= pocket.s && start + dur <= pocket.e && placementIsFeasible(start, dur, ctx)
    const starts = candidateStarts(pocket, dur, ctx)
    const candidateInfos: Array<{ start: number; info: CandidateInfo }> = []
    let best: number[] | null = null
    for (const s of starts) {
      const info = s === start ? attempted : candidateKey(pocket, s, dur, ctx, protectedBefore)
      candidateInfos.push({ start: s, info })
      if (best === null || compareKeys(info.key, best) < 0) best = info.key
    }

    const result: GuardResult = {
      verdict: 'ok',
      alternatives: [],
      alternativeKind: null,
      protectedCapacityBefore: attempted.protectedCapacityBefore,
      protectedCapacityAfter: attempted.protectedCapacityAfter,
      protectedCapacityLoss: attempted.key[0],
      protectedWindowsBefore: attempted.protectedWindowsBefore.slice(),
      protectedWindowsAfter: attempted.protectedWindowsAfter.slice(),
    }

    /** An impossible placement must never inherit an ok/exempt/degraded rank. */
    if (!attemptedFeasible) {
      result.verdict = 'refuse'
      result.reason = { code: 'R-UNAVAILABLE', params: { start, dur }, ackAllowed: false }
      const choices = nearestBestAlternatives(candidateInfos, start, attempted.key, best, false)
      result.alternatives = choices.starts
      result.alternativeKind = choices.kind
      return result
    }

    if (isZeroKey(attempted.key)) {
      if (attempted.exemptionApplied) {
        result.verdict = 'exempt'
        result.reason = {
          code: 'EXEMPT',
          params: {
            trigger: attempted.wallSide ? 'wall' : 'leadTime',
            wallType: attempted.wallSide ? pocket.walls?.[attempted.wallSide] ?? null : null,
          },
        }
      } else {
        result.verdict = 'ok'
      }
      return result
    }

    if (best !== null && compareKeys(best, attempted.key) < 0) {
      result.verdict = 'refuse'
      const reason = reasonForKey(attempted.key, attempted.lossSet, attempted)
      reason.ackAllowed = mode === 'standard'
      result.reason = reason
      const choices = nearestBestAlternatives(candidateInfos, start, attempted.key, best, true)
      result.alternatives = choices.starts
      result.alternativeKind = choices.kind
      return result
    }

    /** Nowhere wins — the loss is unavoidable. Log it, do not refuse. */
    result.verdict = 'degraded'
    const equal = candidateInfos.find((c) => compareKeys(c.info.key, attempted.key) === 0)
    result.leastLossStart = equal ? equal.start : start
    const underlying = reasonForKey(attempted.key, attempted.lossSet, attempted)
    result.reason = { code: 'DEGRADED', params: { t: result.leastLossStart, ...underlying.params } }
    return result
  }

  return { durationSet, fillableExactly, fillDecomposition, hostable, protectedCapacity, safeStarts, evaluate }
}

export type GapGuard = ReturnType<typeof createGapGuard>
