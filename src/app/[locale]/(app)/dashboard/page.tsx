import { QuietRefresh } from '@/components/perf/QuietRefresh'
import { renderStamp } from '@/lib/perf/render-stamp'
import { getLocale } from 'next-intl/server'
import { getStaffList, getCurrentUserStaffId, getBusinessId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { DashboardPageView } from '@/components/dashboard/redesign/DashboardPageView'
import { getDashboardData } from '@/lib/dashboard/cached'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { startTiming } from '@/lib/perf/timing'
import { emptyPackAlerts, getPackAlerts } from '@/lib/packs/alerts'
import { loadUnprocessedVisits } from '@/lib/packs/reconcile'
import { listAllPackUsage } from '@/lib/packs/store'
import { can } from '@/lib/auth/require-permission'
import { getSynqedClient } from '@/lib/synqed/client'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { buildDashboardScreen } from '@/lib/dashboard/screen'

// Param resolution stays here (cookie session); the whole Stage-2 derivation
// lives in @/lib/dashboard/screen (design-parity P-B-1) — shared verbatim
// with the facade screen GET (PR 2) so the web page and the binary render
// from ONE implementation. This file keeps only the cookie-scoped fan-out.

export default async function DashboardPage() {
  const t = startTiming('dashboard')
  // RBAC store scope — resolved ONCE, shared by every store-scoped read on
  // this page (pack alerts, reconcile, pack-usage lens, attention-AI cache
  // key). Pack data has no store column server-side (#465 family), so the
  // pack surfaces clamp by store MEMBERSHIP: drop holders outside the
  // viewer's store-filtered customer list.
  const storeScopePromise = resolveStoreScope().catch(() => null)

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
    businessId,
    synqed,
  ] = await Promise.all([
    t.phase('staffList', () => getStaffList()),
    t.phase('activeStaffId', () => getCurrentUserStaffId()),
    t.phase('dashboardData', () => getDashboardData()),
    t.phase('orgSettings', () => getOrgSettings()),
    getLocale(),
    t.phase('customerList', () => getCachedCustomerList()),
    // 離客/upsell alerts — { [], [] } until the ticket_packs migration applies.
    // Fail CLOSED on scope-resolution failure (s === null): empty pack data,
    // never the unfiltered business-wide read. A RESOLVED scope with storeId
    // null (no-stores business) keeps the unfiltered behavior.
    t.phase('packAlerts', () =>
      storeScopePromise.then((s) =>
        s ? getPackAlerts(undefined, s.storeId) : emptyPackAlerts(),
      ),
    ),
    t.phase('reconcile', () =>
      storeScopePromise.then((s) =>
        s ? loadUnprocessedVisits(s.storeId) : { entries: [], truncated: 0 },
      ),
    ),
    // Manager+ only may dismiss (Kitano's rule) — alerts.manage capability.
    can('alerts.manage').catch(() => false),
    // Per-customer 残回数 — the ticket chips on hero + day flow.
    t.phase('packUsage', () => listAllPackUsage()),
    getBusinessId().catch(() => null),
    // Resolved ONCE here (cookie-scoped) and threaded into the screen builder
    // as an explicit dep — the moved Stage-2 body no longer reads cookies.
    getSynqedClient().catch((err) => {
      console.warn('[dashboard] synqed client init failed:', err)
      return null
    }),
  ])

  const scope = await storeScopePromise

  const screen = await buildDashboardScreen({
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
  })

  return (
    <>
      {/* SWR delivery: this screen may have been served from the
          router cache — stamp when the SERVER built it so a stale
          copy refreshes itself behind the paint. */}
      <QuietRefresh renderedAt={renderStamp()} />
      <DashboardPageView
        dateLabel={screen.dateLabel}
        isOwner={screen.isOwner}
        onboardingComplete={screen.onboardingComplete}
        heroSlides={screen.heroSlides}
        heroTomorrow={screen.heroTomorrow}
        doneCount={screen.doneCount}
        karuteTodos={screen.karuteTodos}
        redeemTodos={screen.redeemTodos}
        attentionItems={screen.attentionItems}
        totalToday={screen.totalToday}
        renewals={screen.renewals}
        rebooks={screen.rebooks}
        winbacks={screen.winbacks}
        tomorrow={screen.tomorrow}
        packAlerts={screen.packAlerts}
        reconcile={screen.reconcile}
        canDismissAlerts={screen.canDismissAlerts}
        pulse={screen.pulse}
        ticketsEnabled={screen.ticketsEnabled}
      />
    </>
  )
}
