// ─────────────────────────────────────────────────────────────────────────
// Coaching data contract — the single typed seam between the coaching UI and
// the data layer Anthony implements (COACHING_V2_DESIGN §9)
// ─────────────────────────────────────────────────────────────────────────
// Every coaching component reads these shapes and NOTHING ELSE. The backend
// fills them; the frontend renders them. One source of truth for coaching data,
// replacing the shapes currently scattered inline across the redesign cards +
// owner-types.ts (those migrate into this file as each card is wired).
//
// THE VISIBILITY MODEL IS ENFORCED IN THE TYPES (COACHING_VISIBILITY_MODEL.md).
// This is the load-bearing idea. There are three *distinct* view types, one per
// who's-looking, and each carries ONLY what that viewer is allowed to see:
//
//   StaffCoachingView   (L1, self)            → full depth, receipts, verbatim.
//   ManagerCoachingView (L2, under a grant)   → banded; no receipts, no verbatim.
//   OwnerTriageView     (L2, aggregate)       → triage bands + help actions only.
//
// A raw staff number, a transcript moment, or a named finding simply DOES NOT
// EXIST on the owner/manager types — so a mis-wired component can't leak one,
// because there is no field to read it from. The privacy guarantee is a
// compile-time fact, not a runtime hope. RLS enforces the same wall server-side
// (defence in depth); this contract makes the client incapable of asking for
// more than the viewer's scope.
//
// DATA-DRIVEN BACKBONE (coaching-design-principle, "not gamified"): the spine is
// real business metrics — closing rate, rebooking rate, satisfaction, revenue,
// per-category scores — that GENERALIZE across all 26 business types. Nothing
// here is salon-specific: display labels resolve via the business-type tokens
// (business-ai-tokens.ts) + next-intl in the component, so a dental clinic and a
// gym render the same structure in their own vocabulary. Keep this file
// language-neutral — keys here, words in the locale layer.
//
// MONEY IS VERSATILE (staff-earnings-incentives): never a bare JPY number.
// `MoneyAmount` always carries its currency so the same code serves any country.

// ── Primitives ─────────────────────────────────────────────────────────────

/** A currency-tagged amount. NEVER assume JPY — the customer app is multi-country
 *  (staff-earnings-incentives). `currency` is an ISO 4217 code. */
export interface MoneyAmount {
  amount: number
  currency: string
}

/** One point on a trend line (e.g. a month of closing rate). `value` is in the
 *  metric's own units; `label` is a locale-resolved axis tick. */
export interface MetricPoint {
  /** ISO date of the period start — the component formats it for the locale. */
  periodStart: string
  value: number
}

/** Honest confidence, surfaced in the UI so an early read is labeled as early
 *  ("34セッション、まだ荒削り") rather than shown as if it were settled truth. */
export type Confidence = 'low' | 'medium' | 'high'

/** A trajectory bucket vs the staff member's OWN baseline — the unit rankings
 *  are expressed in, for everyone including the owner. A triage board, never a
 *  leaderboard: there is deliberately no numeric rank in this contract. */
export type PerformanceBand = 'growing' | 'steady' | 'needs-support'

// ── The data-driven backbone (shared spine of the staff view) ────────────────

/** The real business metrics that lead the staff view. These are the backbone —
 *  a professional dashboard, not a game skin. Labels swap per business type;
 *  the structure is identical everywhere. */
export interface CoreMetrics {
  /** 成約率 — closing / conversion rate, 0..1. */
  closingRate: number
  /** 再来率 — rebooking / return rate, 0..1. */
  rebookingRate: number
  /** 満足度 — customer satisfaction, 1..5. */
  customerSatisfaction: number
  /** 平均客単価 — average spend per customer, currency-tagged. */
  avgRevenue: MoneyAmount
  /** Sessions the numbers are computed from — the n behind every claim. */
  sessionsAnalyzed: number
}

/** One conversation-skill category scored from sessions (質問の深さ / クロージング /
 *  価格提示 / 受けとめ …). Produced by the category_scoring prompt. This is the
 *  data behind "58 / top 86". */
export interface CategoryScore {
  /** Stable identifier; the human label resolves via business-type tokens. */
  key: string
  /** 0..100. */
  score: number
  /** The top-performer band ceiling for this category, so the staff member sees
   *  the gap to aim at. L1 ONLY — an owner never sees a specific peer's number,
   *  which is why this field lives on the staff view alone. Null when there
   *  isn't yet a trustworthy top band. */
  topBenchmark: number | null
  confidence: Confidence
}

// ── Honest findings — the heart of the staff view (L1 ONLY) ───────────────────

/** The receipts behind a finding. This object is the whole reason findings are
 *  L1-absolute: it carries verbatim customer speech and exact session counts.
 *  It exists ONLY on StaffCoachingView and MUST NEVER be serialized into a
 *  manager or owner payload — the customer never consented to their words
 *  crossing to a third party (COACHING_VISIBILITY_MODEL.md, transcript rule). */
export interface FindingEvidence {
  /** Total sessions considered for this finding — the denominator. */
  sessionCount: number
  /** How many of those exhibited the pattern — the numerator ("8 of 12"). */
  affectedCount: number
  /** Verbatim moments from the staff member's own sessions. L1 ABSOLUTE. */
  transcriptMoments: TranscriptMoment[]
}

/** A single quoted moment. Staff-only, forever. */
export interface TranscriptMoment {
  /** ISO timestamp within the session. */
  at: string
  /** The quoted line. Only the STAFF member ever sees this string. */
  quote: string
  /** Optional one-line note on why this moment illustrates the finding. */
  note?: string
}

/** One honest, evidenced, ranked finding — the good and the bad, specifically.
 *  Severity ranks by outcome impact so the page leads with what matters, not
 *  with what's comfortable. Strengths are findings too (severity 'strength'),
 *  earned and evidenced — never cushioning filler. */
export interface HonestFinding {
  id: string
  /** 'priority' = costing outcomes now, top of the list. 'watch' = worth
   *  attention. 'strength' = working, evidenced, "keep doing this". */
  severity: 'priority' | 'watch' | 'strength'
  /** The metric this finding ties to (a key into CoreMetrics / CategoryScore),
   *  so nothing is an opaque vibe — every finding points at a real number. */
  metricKey: string
  /** The plain-language headline ("提案を急いでいる"). */
  headline: string
  /** The quantified cost, drawn from the evidence ("12回中8回、うち5回不成約"). */
  impact: string
  /** The concrete fix. */
  recommendation: string
  /** The receipts. L1 only — see FindingEvidence. */
  evidence: FindingEvidence
  /** Honest caveat when the sample is still thin; null when mature. */
  confidenceNote: string | null
}

/** A forward-looking focus item — what to work on next, staff-facing. */
export interface FocusRecommendation {
  id: string
  categoryKey: string
  headline: string
  rationale: string
  /** Optional linked learning module id, when one exists for this focus. */
  moduleId: string | null
}

// ── The three view projections (the visibility wall, in types) ────────────────

/** A staff member's own outcome mix for the window — their conversion signal, L1.
 *  `declineReasons` are the DeclineReason keys from outcome-types.ts; `pendingCount`
 *  is the "decide later" backlog — chronically deferring a close is itself a coaching
 *  signal (and quietly rots the training data until it's resolved). */
export interface OutcomesSummary {
  noDealTotal: number
  declineReasons: Array<{ reason: string; count: number }>
  /** 後で決める / 'pending' outcomes not yet resolved. */
  pendingCount: number
}

/** An anonymized top-performer technique (from §14) surfaced for this staff to
 *  learn from — win-only, never a name, never >20 chars verbatim. */
export interface TeamPattern {
  id: string
  categoryKey: string
  /** The transferable behavior, anonymized. */
  behavior: string
  /** e.g. "トップ層の9割が実践" — no individual is ever named. */
  adoptionNote: string
}

/** L1 — the staff member's own mirror. Full depth: real metrics, trend,
 *  per-category gap-to-top, ranked honest findings WITH receipts, strengths,
 *  focus. This is the only view that carries FindingEvidence / transcript. */
export interface StaffCoachingView {
  scope: 'staff-self'
  metrics: CoreMetrics
  /** Trend of the primary metric (closing rate) over the available window. */
  progressHistory: MetricPoint[]
  categories: CategoryScore[]
  /** Ranked by severity/impact. Includes strengths (severity 'strength'). */
  findings: HonestFinding[]
  focus: FocusRecommendation[]
  /** This staff's own no-deal reasons + the unresolved "decide later" backlog. */
  outcomes: OutcomesSummary
  /** Anonymized top-performer techniques to learn from (§14). */
  learnFromTop: TeamPattern[]
  /** Overall honesty caveat for the whole view when the tenant is young. */
  maturityNote: string | null
}

/** Metadata for a staff→manager depth grant (COACHING_VISIBILITY_MODEL.md, the
 *  grant layer). Present only when a live grant exists; the manager view cannot
 *  be constructed without it. */
export interface GrantMeta {
  grantedAt: string
  /** Grants are time-boxed (default 30d) and revocable. */
  expiresAt: string
}

/** A category expressed as a band, not a score — what a manager may see. */
export interface CategoryBand {
  key: string
  band: PerformanceBand
}

/** L2-manager — visible ONLY under an explicit, live, staff-authored grant, and
 *  even then banded: categories to support as buckets, a trajectory, no raw
 *  metrics, no findings, no receipts, no verbatim. Enough to HELP (Japan:
 *  develop, don't judge), never enough to expose. The absence of a `findings`
 *  or `evidence` field here is the guarantee. */
export interface ManagerCoachingView {
  scope: 'manager-granted'
  /** Locale-resolved display name of the staff member who granted access. */
  staffLabel: string
  trajectory: PerformanceBand
  categoriesToSupport: CategoryBand[]
  grant: GrantMeta
}

/** One row of the owner's triage board. Band + whether support is suggested +
 *  the paired help action. No number, no name-and-shame, no detail. */
export interface OwnerTriageRow {
  staffLabel: string
  /** Trajectory vs the staff member's OWN baseline — a triage bucket. */
  band: PerformanceBand
  needsSupport: boolean
  /** Every needs-support flag is paired 1:1 with a concrete help action, so the
   *  board reads as "who to help and how", never "who to be angry at". Null
   *  when the row needs no action. */
  suggestedAction: HelpAction | null
}

/** A concrete, constructive next step the owner/manager can take for a staff
 *  member — assign a module, ask a manager to coach. Never punitive. */
export interface HelpAction {
  kind: 'assign-module' | 'manager-coaching' | 'peer-pairing'
  label: string
  /** Target module when kind === 'assign-module'. */
  moduleId: string | null
}

/** L2-owner — the triage board. Bands + help actions only. Sharing adoption is
 *  an AGGREGATE COUNT (never who-hasn't-shared — anti-coercion). No raw metrics,
 *  no findings, no transcript anywhere in this tree. */
export interface OwnerTriageView {
  scope: 'owner-aggregate'
  roster: OwnerTriageRow[]
  /** How many staff have granted deeper manager access — a count only, never a
   *  per-person flag an owner could use as pressure. */
  sharingAdoption: { granted: number; total: number }
}

// ── Store coaching ROI (L2-owner) — the selling point, honestly ───────────────

/** The measured lift on one store-level metric. Displays are pre-formatted for
 *  locale/currency upstream ("+6pt", "+¥1,200") so the view is a pure renderer and
 *  money stays multi-country. `confidence` comes straight from the effectiveness
 *  engine (effectiveness.ts) and governs the honest label shown. */
export interface StoreMetricLift {
  key: string
  liftDisplay: string
  beforeDisplay: string
  afterDisplay: string
  confidence: 'early' | 'building' | 'mature'
}

/** L2-owner — coaching's measured impact on the STORE's sales: the surface that
 *  sells the next business. EVERY number is a difference-in-differences lift vs
 *  untreated control stores (effectiveness.ts), empirical-Bayes-shrunk and
 *  confidence-labeled — never a raw before/after a good season could fake. Store
 *  aggregate only; no individual staff appears here. */
export interface StoreCoachingRoi {
  scope: 'owner-aggregate'
  headline: { key: string; liftDisplay: string; confidence: 'early' | 'building' | 'mature'; sinceMonths: number }
  /** Treated (this store) vs control (untreated stores), same window; the marker
   *  fraction is where coaching started along the series. */
  trend: { treated: MetricPoint[]; control: MetricPoint[]; coachingStartFraction: number }
  lifts: StoreMetricLift[]
  /** The pays-for-itself estimate — the headline lift in money. Null when
   *  confidence is too low to responsibly state one. */
  monthlyValueEstimate: MoneyAmount | null
}

// ── The dormancy envelope (how every card handles "not wired yet") ────────────

/** Every coaching data hook returns this. Until Anthony wires the real query,
 *  hooks resolve to { status: 'dormant' } and the card renders its 対応予定
 *  chrome — the UI is complete and shippable now, dark until the data lands.
 *  One uniform shape so no card invents its own empty/loading handling. */
export type CoachingDataState<T> =
  | { status: 'dormant' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }

/** The dormant state, shared so cards don't each re-declare it. */
export const DORMANT: { status: 'dormant' } = { status: 'dormant' }
