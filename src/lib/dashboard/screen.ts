// Dashboard-screen assembly (design-parity P-B-1). The page body's Stage-2
// derivation — hero karute lookups, attention summaries, the ONE cached AI
// attention call, and every pure shaping step below it — extracted from the
// page onto explicit inputs so the web page and the (future PR 2) facade
// screen GET render from ONE implementation (the buildAppointmentsScreen /
// runKaruteChat shape). Every cookie-scoped read (synqed client, `can`) is
// resolved by the CALLER and threaded in as an explicit dep — this module
// never reads a cookie.
//
// The move is VERBATIM (byte-identical web behavior): the only changes forced
// by the extraction are (1) `getSynqedClient()` calls become the passed-in
// `synqed` dep, (2) the one packs/store.ts read that happens in THIS stage
// (`listRecentRedemptions`) becomes its WithClient twin against that dep, and
// (3) the `t` (PageTiming) instance is threaded through so Stage-1 + Stage-2
// phases land in one perf log line, same as today.

import type { SynqedClient } from '@synqed-kk/client'
import type { PageTiming } from '@/lib/perf/timing'
import type { StaffMember } from '@/lib/staff'
import type { OrgSettings } from '@/actions/org-settings'
import type { StoreScope } from '@/lib/auth/store-scope'
import { getCachedCustomerListFor, type CachedCustomerOption } from '@/lib/customers/cached'
import {
  enrichCustomers,
  type CustomerEnrichment,
} from '@/lib/customers/list-enrich'
import { isReturningCustomer } from '@/lib/customers/status-signals'
import { firstVisitFromBooking } from '@/lib/customers/first-visit'
import type { DashboardData, DashboardTodayAppointment } from './cached'
import type { PackAlerts } from '@/lib/packs/alerts'
import type { ReconcileData } from '@/lib/packs/reconcile'
import type { CustomerPackUsage } from '@/lib/packs/store'
import { listRecentRedemptionsWithClient } from '@/lib/packs/store'
import { hmInJst, ymdInJst, nowUtc, jstDaysBetween } from '@/lib/date/jst'
import {
  pickHeroSlides,
  pickKaruteTodos,
  cleanRequestNote,
  summaryLine,
  visitRound,
} from './flow'
import {
  pickAttention,
  cycleDays,
  rebookSuggestions,
  fallbackLine,
  type AttentionCandidate,
  type RebookRow,
} from './attention'
import { getDailyAttentionLines } from './daily-attention-ai'
import { effectiveSummary } from '@/lib/karute/effective-summary'
import type { HeroSlideView, TomorrowFirstView } from '@/components/dashboard/redesign/NextCustomerHero'
import type { AttentionCardView } from '@/components/dashboard/redesign/AttentionCards'
import type {
  RenewalView,
  RebookView,
  WinbackView,
} from '@/components/dashboard/redesign/ActionCards'
import type { TomorrowStripData } from '@/components/dashboard/redesign/TomorrowStrip'
import type { KaruteTodoView } from '@/components/dashboard/redesign/TodoCard'

/** 7/3(金) — compact JST date label, locale-aware. */
export function compactDayLabel(d: Date, locale: string): string {
  const loc = locale === 'ja' ? 'ja-JP' : 'en-US'
  const md = d.toLocaleDateString(loc, {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
  })
  const wd = d.toLocaleDateString(loc, { timeZone: 'Asia/Tokyo', weekday: 'short' })
  return locale === 'ja' ? `${md}(${wd})` : `${wd} ${md}`
}

export interface DashboardScreenDeps {
  /** Resolved synqed client, or null when getSynqedClient() failed — the
   *  Stage-2 sites below fall back exactly as the old inline `try { const
   *  synqed = await getSynqedClient() } catch {}` blocks did. */
  synqed: SynqedClient | null
  locale: string
  staffList: StaffMember[]
  activeStaffId: string | null
  dashboard: DashboardData
  orgSettings: OrgSettings | null
  customerList: CachedCustomerOption[]
  packAlerts: PackAlerts
  reconcile: ReconcileData
  canDismissAlerts: boolean
  packUsage: Map<string, CustomerPackUsage>
  businessId: string | null
  scope: StoreScope | null
  /** Same PageTiming instance the page's Stage-1 fan-out already used — the
   *  Stage-2 phases below and the final t.end() log line join it. */
  t: PageTiming
  /** WEB opt-in: keep the 要注目 model call OUT of the render path (serve the
   *  ai_cache hit, otherwise deterministic lines now + generate after the
   *  response). Default false so the facade screen route — whose one-shot
   *  packet has no second render to pick up a late fill — is untouched. */
  deferAttentionAi?: boolean
}

export interface DashboardScreen {
  dateLabel: string
  isOwner: boolean
  onboardingComplete: boolean
  heroSlides: HeroSlideView[]
  heroTomorrow: TomorrowFirstView | null
  doneCount: number
  karuteTodos: KaruteTodoView[]
  redeemTodos: ReconcileData['entries']
  attentionItems: AttentionCardView[]
  totalToday: number
  renewals: RenewalView[]
  rebooks: RebookView[]
  winbacks: WinbackView[]
  tomorrow: TomorrowStripData | null
  packAlerts: PackAlerts
  reconcile: ReconcileData
  canDismissAlerts: boolean
  pulse: { redemptions: number; karute: number }
  ticketsEnabled: boolean
}

export async function buildDashboardScreen(
  deps: DashboardScreenDeps,
): Promise<DashboardScreen> {
  const {
    synqed,
    locale,
    staffList,
    activeStaffId,
    dashboard,
    orgSettings,
    customerList,
    packAlerts,
    reconcile,
    canDismissAlerts,
    packUsage,
    businessId,
    scope,
    t,
    deferAttentionAi = false,
  } = deps

  const now = nowUtc()
  const todayYmd = ymdInJst(now)

  // 回数券 off (org setting): the fetch wave above stays fully parallel
  // (orgSettings is inside it), so the three pack reads still run — cheap,
  // cached, and harmless — and their RESULTS are blanked here instead. Every
  // downstream chip/list/total then naturally disappears, and the two pack
  // cards are hidden outright via ticketsEnabled.
  const ticketsEnabled = orgSettings?.ticket_packs_enabled ?? true
  // Store lens on the raw usage map (rebook rows + 残N chips + enrichment id
  // set). getPackAlerts applies the same lens internally; the shared 60s
  // customer-list cache makes the second read free. Fail CLOSED: if the lens
  // fetch errors, show no pack rows rather than another store's.
  // scope === null (resolution failed) or a required lens without businessId
  // → fail closed (no pack rows), matching the packAlerts/reconcile guards.
  let packUsageLensed =
    scope && !(scope.storeId && !businessId)
      ? packUsage
      : (new Map() as typeof packUsage)
  if (scope?.storeId && businessId && packUsage.size > 0) {
    try {
      const storeCustomers = await getCachedCustomerListFor(
        businessId,
        scope.storeId,
      )
      const inStore = new Set(storeCustomers.map((c) => c.id))
      packUsageLensed = new Map(
        [...packUsage].filter(([id]) => inStore.has(id)),
      )
    } catch {
      packUsageLensed = new Map() as typeof packUsage
    }
  }
  const packUsageView = ticketsEnabled
    ? packUsageLensed
    : (new Map() as typeof packUsage)
  const packAlertsView = ticketsEnabled
    ? packAlerts
    : {
        contact: [],
        low: [],
        inProgress: [],
        totals: { atRiskValue: 0, unconsumedTotal: 0, holderCount: 0 },
        monthly: { contacted: 0, rebooked: 0 },
      }
  const reconcileView = ticketsEnabled ? reconcile : { entries: [], truncated: 0 }

  // ── shared lookups ────────────────────────────────────────────────
  const staffNameById = new Map(staffList.map((s) => [s.id, s.full_name ?? 'Unknown']))
  const customerById = new Map(customerList.map((c) => [c.id, c] as const))

  // The cached dashboard fetch resolves names from a single 500-row page;
  // the fully-paginated customer list backfills anyone past that cap.
  const nameFor = (a: DashboardTodayAppointment): string =>
    a.customers?.name ?? customerById.get(a.client_id)?.name ?? 'Unknown'

  // Enrichment (karute count / past-appointment count / visit dates) — the
  // SAME first-time signals the agenda uses, plus all pack holders for the
  // rebook-rhythm math. One cached business-wide aggregate underneath, so the
  // wider id set costs nothing extra.
  const dayClientIds = [
    ...new Set([
      ...[...dashboard.todayAppointments, ...dashboard.tomorrowAppointments].map(
        (a) => a.client_id,
      ),
      ...packUsageView.keys(),
    ]),
  ]
  // Owner detection up front — it gates the owner-only redemptions fetch.
  const activeStaff = staffList.find((s) => s.id === activeStaffId)
  const isOwner =
    (activeStaff as { display_role?: string | null } | null)?.display_role ===
    'owner'

  // ── stage 2: three independent reads, in PARALLEL (no waterfall) ──
  const slides = pickHeroSlides(dashboard.todayAppointments, now)
  const emptyKaruteMap = () =>
    new Map<string, { text: string; dateLabel: string; href: string }>()
  const [enrichment, lastKarute, recentRedemptions] = await Promise.all([
    // Enrichment (karute/past-appointment counts) — same signals as agenda.
    businessId && dayClientIds.length
      ? enrichCustomers(businessId, dayClientIds).catch(
          () => new Map<string, CustomerEnrichment>(),
        )
      : Promise.resolve(new Map<string, CustomerEnrichment>()),
    // Last AI karute line per hero customer (≤3 lookups).
    t.phase('heroKarute', async () => {
      if (slides.length === 0) return emptyKaruteMap()
      try {
        if (!synqed) throw new Error('synqed client unavailable')
        const results = await Promise.all(
          slides.map((s) =>
            synqed.karuteRecords
              .list({ customer_id: s.appointment.client_id, page_size: 1 })
              .then((r) => r.karute_records[0] ?? null)
              .catch(() => null),
          ),
        )
        const map = emptyKaruteMap()
        results.forEach((rec, i) => {
          const text = summaryLine(rec ? effectiveSummary(rec) : null)
          if (rec && text) {
            map.set(slides[i].appointment.client_id, {
              text,
              dateLabel: compactDayLabel(new Date(rec.created_at), locale),
              href: `/karute/${rec.id}`,
            })
          }
        })
        return map
      } catch {
        return emptyKaruteMap()
      }
    }),
    // 7-day burn count — only the owner band consumes it; staff skip the call.
    isOwner
      ? t.phase('redemptions7d', async () => {
          // listRecentRedemptionsWithClient THROWS (WithClient convention) —
          // this call site keeps the SAME graceful-empty contract
          // listRecentRedemptions() had (a transient core hiccup must not
          // crash the 7-day owner pulse).
          try {
            if (!synqed) throw new Error('synqed client unavailable')
            return await listRecentRedemptionsWithClient(synqed, 7)
          } catch (err) {
            console.warn('[dashboard] redemptions7d failed:', err)
            return []
          }
        })
      : Promise.resolve(
          [] as Awaited<ReturnType<typeof listRecentRedemptionsWithClient>>,
        ),
  ])

  const isFirstTime = (clientId: string): boolean => {
    const c = customerById.get(clientId)
    const e = enrichment.get(clientId)
    return !isReturningCustomer({
      joinDateIso: null,
      lastVisitIso: e?.lastVisitIso ?? null,
      isExistingCustomer: c?.isExistingCustomer,
      visitCount: c?.visitCount,
      karuteCount: e?.totalKarute,
      pastAppointmentCount: e?.pastAppointmentCount,
      hasTicketPack: (c?.hasTicketPack ?? false) || packUsageView.has(clientId),
    })
  }
  const ticketFor = (clientId: string): { remaining: number; size: number } | null => {
    const u = packUsageView.get(clientId)
    return u?.hasActivePack ? { remaining: u.remaining, size: u.size } : null
  }
  // The reservation system outranks inference (Liam's rule): a 新規-course
  // booking IS a first visit; any other named course means returning. Only
  // titleless bookings fall back to history-based inference.
  const firstVisitFor = (a: DashboardTodayAppointment): boolean =>
    firstVisitFromBooking(a.title) ?? isFirstTime(a.client_id)

  const toHeroView = (s: (typeof slides)[number]): HeroSlideView => {
    const a = s.appointment
    const c = customerById.get(a.client_id)
    return {
      appointmentId: a.id,
      clientId: a.client_id,
      customerName: nameFor(a),
      startIso: a.start_time,
      timeHm: hmInJst(new Date(a.start_time)),
      durationMinutes: a.duration_minutes,
      inProgress: s.inProgress,
      round: visitRound(c?.visitCount ?? 0, !firstVisitFor(a)),
      course: a.title,
      staffName: staffNameById.get(a.staff_profile_id) ?? 'Unknown',
      ticket: ticketFor(a.client_id),
      requestNote: cleanRequestNote(a.notes),
      lastVisit: lastKarute.get(a.client_id) ?? null,
    }
  }
  const heroSlides = slides.map(toHeroView)

  const doneCount = dashboard.todayAppointments.filter((a) => {
    const ended =
      new Date(a.start_time).getTime() + a.duration_minutes * 60_000 <= now.getTime()
    return Boolean(a.karute_record_id) || ended
  }).length

  // ── 要注目: today's noteworthy customers + one-line AI prep notes ──
  const candidates: AttentionCandidate[] = dashboard.todayAppointments.map((a) => {
    const u = packUsageView.get(a.client_id)
    const e = enrichment.get(a.client_id)
    return {
      appointmentId: a.id,
      clientId: a.client_id,
      startIso: a.start_time,
      firstTime: firstVisitFor(a),
      remaining: u?.hasActivePack ? u.remaining : null,
      size: u?.hasActivePack ? u.size : null,
      hadPack: customerById.get(a.client_id)?.hasTicketPack ?? false,
      daysSinceLastVisit: e?.lastVisitIso ? jstDaysBetween(e.lastVisitIso, now) : null,
      memo: cleanRequestNote(a.notes),
    }
  })
  const attention = pickAttention(candidates)

  // Last-visit summaries for attention customers the hero fetch didn't cover,
  // then ONE cached AI call for all the prep lines (deterministic fallback).
  const attentionInputs = await t.phase('attentionSummaries', async () => {
    const missing = attention.filter((i) => !lastKarute.has(i.clientId))
    const extra = new Map<string, string>()
    if (missing.length > 0) {
      try {
        if (!synqed) throw new Error('synqed client unavailable')
        const recs = await Promise.all(
          missing.map((i) =>
            synqed.karuteRecords
              .list({ customer_id: i.clientId, page_size: 1 })
              .then((r) => r.karute_records[0] ?? null)
              .catch(() => null),
          ),
        )
        recs.forEach((rec, idx) => {
          const text = summaryLine(rec ? effectiveSummary(rec) : null)
          if (text) extra.set(missing[idx].clientId, text)
        })
      } catch {
        /* summaries are optional context — lines fall back without them */
      }
    }
    return attention.map((i) => ({
      ...i,
      name:
        dashboard.todayAppointments.find((a) => a.client_id === i.clientId)?.customers
          ?.name ??
        customerById.get(i.clientId)?.name ??
        'Unknown',
      lastSummary: lastKarute.get(i.clientId)?.text ?? extra.get(i.clientId) ?? null,
    }))
  })
  // Same clamped store as the dashboard data scope: the attention-AI cache key
  // must not key on the raw cookie (a branch-restricted staff with an unset
  // cookie would key/scope by the primary store, not their assigned one).
  const activeStoreId = scope?.storeId ?? null
  const attentionLines = await t.phase('attentionAI', () =>
    getDailyAttentionLines({
      items: attentionInputs,
      businessType: orgSettings?.business_type,
      businessId,
      storeId: activeStoreId,
      dateYmd: todayYmd,
      locale,
      cacheOnly: deferAttentionAi,
    }).catch(() => new Map(attentionInputs.map((i) => [i.clientId, fallbackLine(i)]))),
  )
  const attentionItems: AttentionCardView[] = attentionInputs.map((i) => ({
    clientId: i.clientId,
    timeHm: hmInJst(new Date(i.startIso)),
    name: i.name,
    badge: i.badge,
    badgeDays: i.daysSinceLastVisit ?? undefined,
    line: attentionLines.get(i.clientId) ?? fallbackLine(i),
  }))

  // ── 推奨アクション: renewal moment, rebook rhythm, win-back ────────
  const renewals: RenewalView[] = attentionInputs
    .filter((i) => i.badge === 'lastOne')
    .map((i) => {
      const e = enrichment.get(i.clientId)
      return {
        clientId: i.clientId,
        name: i.name,
        timeHm: hmInJst(new Date(i.startIso)),
        cycle: cycleDays(
          e?.firstVisitIso ?? null,
          e?.lastVisitIso ?? null,
          e?.datedVisitCount ?? 0,
        ),
      }
    })
  const rebookRows: RebookRow[] = [...packUsageView.entries()]
    .filter(([, u]) => u.hasActivePack && u.remaining > 0)
    .flatMap(([clientId, u]) => {
      const name = customerById.get(clientId)?.name
      const e = enrichment.get(clientId)
      if (!name || !e) return []
      return [
        {
          clientId,
          name,
          remaining: u.remaining,
          firstVisitIso: e.firstVisitIso,
          lastVisitIso: e.lastVisitIso,
          datedVisitCount: e.datedVisitCount,
          nextAppointmentIso: e.nextAppointmentIso,
        },
      ]
    })
  const rebooks: RebookView[] = rebookSuggestions(rebookRows, { todayYmd }).map((s) => {
    const d = new Date(`${s.dueYmd}T00:00:00Z`)
    return {
      clientId: s.clientId,
      name: s.name,
      remaining: s.remaining,
      dueLabel: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
    }
  })
  const winbacks: WinbackView[] = [...packAlertsView.contact]
    .sort((a, b) => (b.daysSinceLastVisit ?? 0) - (a.daysSinceLastVisit ?? 0))
    .slice(0, 3)
    .map((c) => ({
      clientId: c.customerId,
      name: c.name,
      remaining: c.remaining,
      days: c.daysSinceLastVisit ?? 0,
    }))

  // ── todos: today-only misses, capped at 3 ────────────────────────
  // Recording covers the burn too (the record dialog has the 消化 toggle),
  // so an unrecorded visit surfaces ONLY as a 録音 todo — never both.
  const karuteTodos = pickKaruteTodos(dashboard.todayAppointments, now).map((a) => ({
    appointmentId: a.id,
    customerName: nameFor(a),
    timeHm: hmInJst(new Date(a.start_time)),
  }))
  const redeemTodosToday = reconcileView.entries.filter(
    (e) => e.visitDay === todayYmd && e.kind !== 'unrecorded',
  )
  const cappedKarute = karuteTodos.slice(0, 3)
  const cappedRedeem = redeemTodosToday.slice(0, Math.max(0, 3 - cappedKarute.length))

  // ── tomorrow ──────────────────────────────────────────────────────
  const tomorrowAppts = [...dashboard.tomorrowAppointments].sort((a, b) =>
    a.start_time.localeCompare(b.start_time),
  )
  const first = tomorrowAppts[0] ?? null
  const tomorrowDate = first ? new Date(first.start_time) : null
  const tomorrowStrip: TomorrowStripData | null = first
    ? {
        dateLabel: compactDayLabel(tomorrowDate!, locale),
        ymd: ymdInJst(tomorrowDate!),
        count: tomorrowAppts.length,
        firstTimers: tomorrowAppts.filter((a) => firstVisitFor(a)).length,
        firstTimeHm: hmInJst(tomorrowDate!),
        firstName: nameFor(first),
      }
    : null
  const heroTomorrow: TomorrowFirstView | null =
    heroSlides.length === 0 && tomorrowStrip
      ? {
          dateLabel: tomorrowStrip.dateLabel,
          timeHm: tomorrowStrip.firstTimeHm,
          customerName: tomorrowStrip.firstName,
          count: tomorrowStrip.count,
        }
      : null

  // Timing closes after the derivations too, so the metric reports the real
  // server cost of the page, not just the fetch fan-out.
  t.end()

  return {
    dateLabel: compactDayLabel(now, locale),
    isOwner,
    onboardingComplete: Boolean(orgSettings?.setup_completed_at),
    heroSlides,
    heroTomorrow,
    doneCount,
    karuteTodos: cappedKarute,
    redeemTodos: cappedRedeem,
    attentionItems,
    totalToday: dashboard.todayAppointments.length,
    renewals,
    rebooks,
    winbacks,
    tomorrow: tomorrowStrip,
    packAlerts: packAlertsView,
    // Today's unredeemed rows live in やること — the owner backlog shows
    // strictly-past days so the same visit never appears twice.
    reconcile: {
      entries: reconcileView.entries.filter((e) => e.visitDay !== todayYmd),
      truncated: reconcileView.truncated,
    },
    canDismissAlerts,
    pulse: { redemptions: recentRedemptions.length, karute: dashboard.weekKaruteCount },
    ticketsEnabled,
  }
}
