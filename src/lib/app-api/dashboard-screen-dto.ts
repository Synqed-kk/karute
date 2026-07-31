// Dashboard screen DTO — the Bearer twin of DashboardPageView's prop surface
// (design-parity Gap B-1 PR 2). Mirrors the DashboardScreen interface
// assembled by buildDashboardScreen (src/lib/dashboard/screen.ts, PR 1):
// coarse and screen-shaped like every screens/* DTO, so the thin screen
// renders DashboardPageView from this verbatim.

import { z } from 'zod'

// ── NextCustomerHero (HeroSlideView / TomorrowFirstView) ────────────────────
const VisitRoundDTO = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('first') }),
  z.object({ kind: z.literal('nth'), n: z.number() }),
  z.object({ kind: z.literal('repeat') }),
])

const HeroSlideViewDTO = z.object({
  appointmentId: z.string(),
  clientId: z.string(),
  customerName: z.string(),
  startIso: z.string(),
  timeHm: z.string(),
  durationMinutes: z.number(),
  inProgress: z.boolean(),
  round: VisitRoundDTO,
  course: z.string().nullable(),
  staffName: z.string(),
  ticket: z.object({ remaining: z.number(), size: z.number() }).nullable(),
  requestNote: z.string().nullable(),
  lastVisit: z.object({ text: z.string(), dateLabel: z.string(), href: z.string() }).nullable(),
})

const TomorrowFirstViewDTO = z.object({
  dateLabel: z.string(),
  timeHm: z.string(),
  customerName: z.string(),
  count: z.number(),
})

// ── TodoCard (KaruteTodoView / ReconcileEntry) ───────────────────────────────
const KaruteTodoViewDTO = z.object({
  appointmentId: z.string(),
  customerName: z.string(),
  timeHm: z.string(),
})

const ReconcileEntryDTO = z.object({
  customerId: z.string(),
  appointmentId: z.string(),
  visitDay: z.string(),
  kind: z.enum(['unrecorded', 'unredeemed']),
  name: z.string(),
  karuteNumber: z.string().nullable(),
  remaining: z.number(),
  size: z.number(),
  packId: z.string().nullable(),
})

// ── AttentionCards (AttentionCardView) ───────────────────────────────────────
const AttentionCardViewDTO = z.object({
  clientId: z.string(),
  timeHm: z.string(),
  name: z.string(),
  badge: z.enum(['lastOne', 'packDone', 'first', 'comeback', 'memo']),
  badgeDays: z.number().optional(),
  line: z.string(),
})

// ── ActionCards (RenewalView / RebookView / WinbackView) ────────────────────
const RenewalViewDTO = z.object({
  clientId: z.string(),
  name: z.string(),
  timeHm: z.string(),
  cycle: z.number().nullable(),
})

const RebookViewDTO = z.object({
  clientId: z.string(),
  name: z.string(),
  remaining: z.number(),
  dueLabel: z.string(),
})

const WinbackViewDTO = z.object({
  clientId: z.string(),
  name: z.string(),
  remaining: z.number(),
  days: z.number(),
})

// ── TomorrowStrip (TomorrowStripData) ────────────────────────────────────────
const TomorrowStripDataDTO = z.object({
  dateLabel: z.string(),
  ymd: z.string(),
  count: z.number(),
  firstTimers: z.number(),
  firstTimeHm: z.string(),
  firstName: z.string(),
})

// ── OwnerBand (PackAlerts / ReconcileData) ───────────────────────────────────
const PackAlertEntryDTO = z.object({
  customerId: z.string(),
  name: z.string(),
  karuteNumber: z.string().nullable(),
  remaining: z.number(),
  size: z.number(),
  unconsumed: z.number(),
  daysSinceLastVisit: z.number().nullable(),
  hasNextBooking: z.boolean(),
})

const PackAlertsDTO = z.object({
  contact: z.array(PackAlertEntryDTO),
  low: z.array(PackAlertEntryDTO),
  inProgress: z.array(PackAlertEntryDTO),
  totals: z.object({
    atRiskValue: z.number(),
    unconsumedTotal: z.number(),
    holderCount: z.number(),
  }),
  monthly: z.object({ contacted: z.number(), rebooked: z.number() }),
})

const ReconcileDataDTO = z.object({
  entries: z.array(ReconcileEntryDTO),
  truncated: z.number(),
})

export const DashboardScreenDTO = z.object({
  dateLabel: z.string(),
  isOwner: z.boolean(),
  onboardingComplete: z.boolean(),
  heroSlides: z.array(HeroSlideViewDTO),
  heroTomorrow: TomorrowFirstViewDTO.nullable(),
  doneCount: z.number(),
  karuteTodos: z.array(KaruteTodoViewDTO),
  redeemTodos: z.array(ReconcileEntryDTO),
  attentionItems: z.array(AttentionCardViewDTO),
  totalToday: z.number(),
  renewals: z.array(RenewalViewDTO),
  rebooks: z.array(RebookViewDTO),
  winbacks: z.array(WinbackViewDTO),
  tomorrow: TomorrowStripDataDTO.nullable(),
  packAlerts: PackAlertsDTO,
  reconcile: ReconcileDataDTO,
  canDismissAlerts: z.boolean(),
  pulse: z.object({ redemptions: z.number(), karute: z.number() }),
  ticketsEnabled: z.boolean(),
})

export type DashboardScreenDTOType = z.infer<typeof DashboardScreenDTO>
