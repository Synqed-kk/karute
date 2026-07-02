import { getLocale } from 'next-intl/server'
import { getStaffList, getCurrentUserStaffId, getBusinessId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { DashboardPageView } from '@/components/dashboard/redesign/DashboardPageView'
import { getDashboardData, type DashboardTodayAppointment } from '@/lib/dashboard/cached'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { assignStaffColors } from '@/lib/staff-colors'
import { startTiming } from '@/lib/perf/timing'
import { getPackAlerts } from '@/lib/packs/alerts'
import { loadUnprocessedVisits } from '@/lib/packs/reconcile'
import { listAllPackUsage, listRecentRedemptions } from '@/lib/packs/store'
import { can } from '@/lib/auth/require-permission'
import { getSynqedClient } from '@/lib/synqed/client'
import {
  enrichCustomers,
  isReturningCustomer,
  type CustomerEnrichment,
} from '@/lib/customers/list-enrich'
import { hmInJst, ymdInJst, nowUtc } from '@/lib/date/jst'
import {
  pickHeroSlides,
  pickKaruteTodos,
  cleanRequestNote,
  summaryLine,
  visitRound,
} from '@/lib/dashboard/flow'
import type { HeroSlideView, TomorrowFirstView } from '@/components/dashboard/redesign/NextCustomerHero'
import type { DayFlowRow } from '@/components/dashboard/redesign/DayFlow'
import type { TomorrowStripData } from '@/components/dashboard/redesign/TomorrowStrip'

/** 7/3(金) — compact JST date label, locale-aware. */
function compactDayLabel(d: Date, locale: string): string {
  const loc = locale === 'ja' ? 'ja-JP' : 'en-US'
  const md = d.toLocaleDateString(loc, {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
  })
  const wd = d.toLocaleDateString(loc, { timeZone: 'Asia/Tokyo', weekday: 'short' })
  return locale === 'ja' ? `${md}(${wd})` : `${wd} ${md}`
}

export default async function DashboardPage() {
  const t = startTiming('dashboard')

  const [
    staffList,
    activeStaffId,
    dashboard,
    orgSettings,
    locale,
    customerList,
    packAlerts,
    reconcile,
    canDismissAlerts,
    packUsage,
    recentRedemptions,
    businessId,
  ] = await Promise.all([
    t.phase('staffList', () => getStaffList()),
    t.phase('activeStaffId', () => getCurrentUserStaffId()),
    t.phase('dashboardData', () => getDashboardData()),
    t.phase('orgSettings', () => getOrgSettings()),
    getLocale(),
    t.phase('customerList', () => getCachedCustomerList()),
    // 離客/upsell alerts — { [], [] } until the ticket_packs migration applies.
    t.phase('packAlerts', () => getPackAlerts()),
    t.phase('reconcile', () => loadUnprocessedVisits()),
    // Manager+ only may dismiss (Kitano's rule) — alerts.manage capability.
    can('alerts.manage').catch(() => false),
    // Per-customer 残回数 — the ticket chips on hero + day flow.
    t.phase('packUsage', () => listAllPackUsage()),
    // 7-day burn count for the owner pulse (degrades to []).
    t.phase('redemptions7d', () => listRecentRedemptions(7)),
    getBusinessId().catch(() => null),
  ])

  const now = nowUtc()
  const todayYmd = ymdInJst(now)

  // ── shared lookups ────────────────────────────────────────────────
  const staffNameById = new Map(staffList.map((s) => [s.id, s.full_name ?? 'Unknown']))
  const staffColors = assignStaffColors(staffList.map((s) => s.id))
  const customerById = new Map(customerList.map((c) => [c.id, c] as const))

  // The cached dashboard fetch resolves names from a single 500-row page;
  // the fully-paginated customer list backfills anyone past that cap.
  const nameFor = (a: DashboardTodayAppointment): string =>
    a.customers?.name ?? customerById.get(a.client_id)?.name ?? 'Unknown'

  // Enrichment (karute count / past-appointment count) — the SAME first-time
  // signals the agenda uses, so the hero never tags a manual regular 初回.
  const dayClientIds = [
    ...new Set(
      [...dashboard.todayAppointments, ...dashboard.tomorrowAppointments].map(
        (a) => a.client_id,
      ),
    ),
  ]
  const enrichment =
    businessId && dayClientIds.length
      ? await enrichCustomers(businessId, dayClientIds).catch(
          () => new Map<string, CustomerEnrichment>(),
        )
      : new Map<string, CustomerEnrichment>()

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
      hasTicketPack: (c?.hasTicketPack ?? false) || packUsage.has(clientId),
    })
  }
  const ticketFor = (clientId: string): { remaining: number; size: number } | null => {
    const u = packUsage.get(clientId)
    return u?.hasActivePack ? { remaining: u.remaining, size: u.size } : null
  }

  // ── hero: next customers + their last AI karute line ─────────────
  const slides = pickHeroSlides(dashboard.todayAppointments, now)
  const lastKarute = await t.phase('heroKarute', async () => {
    if (slides.length === 0) return new Map<string, { text: string; dateLabel: string; href: string }>()
    try {
      const synqed = await getSynqedClient()
      const results = await Promise.all(
        slides.map((s) =>
          synqed.karuteRecords
            .list({ customer_id: s.appointment.client_id, page_size: 1 })
            .then((r) => r.karute_records[0] ?? null)
            .catch(() => null),
        ),
      )
      const map = new Map<string, { text: string; dateLabel: string; href: string }>()
      results.forEach((rec, i) => {
        const text = summaryLine(rec?.ai_summary ?? null)
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
      return new Map<string, { text: string; dateLabel: string; href: string }>()
    }
  })
  t.end()

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
      round: visitRound(c?.visitCount ?? 0, !isFirstTime(a.client_id)),
      course: a.title,
      staffName: staffNameById.get(a.staff_profile_id) ?? 'Unknown',
      ticket: ticketFor(a.client_id),
      requestNote: cleanRequestNote(a.notes),
      lastVisit: lastKarute.get(a.client_id) ?? null,
    }
  }
  const heroSlides = slides.map(toHeroView)

  // ── day flow rows (whole day, done rows collapse client-side) ────
  const rowState = (a: DashboardTodayAppointment): { done: boolean } => {
    const ended = new Date(a.start_time).getTime() + a.duration_minutes * 60_000 <= now.getTime()
    return { done: Boolean(a.karute_record_id) || ended }
  }
  const nextId = heroSlides[0]?.appointmentId ?? null
  const dayRows: DayFlowRow[] = [...dashboard.todayAppointments]
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map((a) => ({
      id: a.id,
      clientId: a.client_id,
      timeHm: hmInJst(new Date(a.start_time)),
      customerName: nameFor(a),
      course: a.title,
      staffInitial: (staffNameById.get(a.staff_profile_id) ?? '?').trim().slice(0, 1) || '?',
      staffColorKey: staffColors.get(a.staff_profile_id)?.key ?? null,
      ticket: ticketFor(a.client_id),
      firstTime: isFirstTime(a.client_id),
      done: rowState(a).done,
      isNext: a.id === nextId,
    }))
  const doneCount = dayRows.filter((r) => r.done).length

  // ── todos: today-only misses, capped at 3 ────────────────────────
  // Recording covers the burn too (the record dialog has the 消化 toggle),
  // so an unrecorded visit surfaces ONLY as a 録音 todo — never both.
  const karuteTodos = pickKaruteTodos(dashboard.todayAppointments, now).map((a) => ({
    appointmentId: a.id,
    customerName: nameFor(a),
    timeHm: hmInJst(new Date(a.start_time)),
  }))
  const redeemTodosToday = reconcile.entries.filter(
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
        firstTimers: tomorrowAppts.filter((a) => isFirstTime(a.client_id)).length,
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

  // ── owner ─────────────────────────────────────────────────────────
  const activeStaff = staffList.find((s) => s.id === activeStaffId)
  const isOwner =
    (activeStaff as { display_role?: string | null } | null)?.display_role === 'owner'

  return (
    <DashboardPageView
      dateLabel={compactDayLabel(now, locale)}
      isOwner={isOwner}
      onboardingComplete={Boolean(orgSettings?.setup_completed_at)}
      heroSlides={heroSlides}
      heroTomorrow={heroTomorrow}
      doneCount={doneCount}
      karuteTodos={cappedKarute}
      redeemTodos={cappedRedeem}
      dayRows={dayRows}
      tomorrow={tomorrowStrip}
      packAlerts={packAlerts}
      // Today's unredeemed rows live in やること — the owner backlog shows
      // strictly-past days so the same visit never appears twice.
      reconcile={{
        entries: reconcile.entries.filter((e) => e.visitDay !== todayYmd),
        truncated: reconcile.truncated,
      }}
      canDismissAlerts={canDismissAlerts}
      pulse={{ redemptions: recentRedemptions.length, karute: dashboard.weekKaruteCount }}
    />
  )
}
