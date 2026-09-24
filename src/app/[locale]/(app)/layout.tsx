import { BottomNav } from '@/components/layout/bottom-nav'
import { MobileHeader } from '@/components/layout/MobileHeader'
import { Sidebar } from '@/components/layout/sidebar'
// AIChatFAB removed — the floating action button overlapped the
// bottom-nav's メニュー tab on mobile, making it un-tappable. AI chat
// is reachable via the /ask-ai route from the menu drawer. If we
// want a quick-access affordance back later, it should be inside the
// bottom-nav strip (e.g. as a center-action mic-style button), not
// floating over it.
// import { AIChatFAB } from '@/components/ai/AIChatFAB'
import { DiscreetRecordingIndicator } from '@/components/recording/DiscreetRecordingIndicator'
import { ProcessingIndicator } from '@/components/recording/ProcessingIndicator'
import { getStaffList, getCurrentUserStaffId, getBusinessId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { getNextCustomer } from '@/lib/appointments/next-customer'
import { SessionProvider } from '@/providers/session-provider'
import { NotificationsProvider } from '@/lib/notifications/context'
import { buildNotificationFeed } from '@/lib/notifications/derive'
import { getMyCapabilities } from '@/lib/auth/require-permission'
import { canReadAuditLog } from '@/lib/auth/audit-read'

import { createClient } from '@/lib/supabase/server'
import { listStores } from '@/actions/stores'
import { resolveShellGate, resolveStoreScope, viewerStaffRoster } from '@/lib/auth/store-scope'
import { reachesNoStore } from '@/lib/auth/store-gate'
import { redirect } from 'next/navigation'
import { UnassignedStoreScreen } from '@/components/layout/UnassignedStoreScreen'
import { StoreOutageScreen } from '@/components/layout/StoreOutageScreen'
import { RemovedStaffScreen } from '@/components/layout/RemovedStaffScreen'

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  // ⚖ Liam 2026-09-16 (G-3 fold, Greptile 2026-09-17) — THE AUTHORITATIVE
  // SESSION CHECK, ahead of the gate AND everything else. A revoked session
  // must redirect before any read starts — including the gate's own
  // (viewerIsUnassigned → getCurrentUserStaffId/getMyCapabilities) — not just
  // before the read wave beneath it. Reused below (the wave no longer
  // re-resolves it).
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (!user || error) {
    redirect(`/${locale}/login`)
  }

  // THE WEB FRONT GATE. A staff member of a multi-store business with no
  // store assigned gets the honest screen and NOTHING ELSE: no nav, no store
  // pills, no notification feed, no roster — and, because this resolves
  // BEFORE the wave below, not one store-scoped read is even started. The
  // backstops underneath would each return empty anyway; this is the layer
  // that makes the screen honest rather than merely empty.
  //
  // It costs no extra round trip in the steady state: the staff id and the
  // capability set it resolves are React-memoized and every surface below
  // reads the same two answers (see actorIsUnassigned).
  //
  // Round 2 (2026-09-24, D-S16-4, discussed, default): a store, roster or
  // permission read that FAILED gets the outage screen — no data, never blank.
  // Round 3 leg 1 (D-S19-1, lead): a person a manager REMOVED from the business
  // gets their own screen first — sign-out only, never the retrying outage.
  const gate = await resolveShellGate()
  if (gate === 'removed') return <RemovedStaffScreen />
  if (gate === 'unassigned') return <UnassignedStoreScreen />
  if (gate === 'outage') return <StoreOutageScreen />

  // RBAC store scope — resolved ONCE (memoized; the gate just resolved it),
  // shared by the switcher AND the notification feed (the feed must read
  // through the same clamped lens as every other store-scoped surface — #465).
  const storeScope = await resolveStoreScope()
  const [staffList, activeStaffId, orgSettings, nextCustomer, notificationFeed, stores] = await Promise.all([
    getStaffList(),
    getCurrentUserStaffId(),
    getOrgSettings(),
    // Bottom-nav next-customer label. Fanned out in parallel with
    // the other layout queries so it doesn't add a serial step.
    // Failure is non-fatal — bottom nav falls back to its scaffold
    // copy ("予約を選択") if this query errors.
    getNextCustomer().catch(() => null),
    // v1 notification feed — DERIVED on the server (no notifications table),
    // seeded here the same way the dashboard seeds packAlerts into its card.
    // Best-effort: a failure degrades to an empty feed (bell shows no badge),
    // never blocks the app shell.
    Promise.all([getBusinessId(), getMyCapabilities().catch(() => null)])
      .then(([businessId, caps]) =>
        // A RESOLVED scope with storeId null (business has no stores) keeps
        // the unfiltered feed. scope.storeId null = "no filter" inside every
        // derived read, so an actor who reaches NO store gets an empty bell,
        // not the business's (⚖ Liam 2026-09-16; census §7).
        !reachesNoStore(storeScope)
          ? buildNotificationFeed(businessId, locale, storeScope.storeId, {
              // The 監査ログ rule (audit.view AND stores.viewAll) — the only
              // viewers whose bell carries recording failures. Fails closed.
              viewerCanViewAudit: caps ? canReadAuditLog(caps) : false,
            })
          : [],
      )
      .catch(() => []),
    // Multi-store header switcher data (best-effort; [] → switcher hides).
    listStores().catch(() => []),
  ])

  // A branch-restricted staff (storeScope.allowedStoreIds set) only sees their
  // own store(s) in the switcher — `[]` lists none; the clamp also picks the
  // active store. Cross-store viewers keep the full list.
  const visibleStores = storeScope.allowedStoreIds
    ? stores.filter((s) => storeScope.allowedStoreIds!.includes(s.id))
    : stores
  const switcherActiveStore = storeScope.storeId

  // Roster the session ships to the client (staff-switch drawer): a clamped
  // staff sees only their own store(s)' staff + themselves; cross-store
  // viewers and floating staff keep the full business roster (Liam 8/17).
  const visibleRoster = await viewerStaffRoster(staffList, activeStaffId ?? user.id)

  const staffItems = visibleRoster.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
    displayRole: (s as { display_role?: string }).display_role ?? 'staff',
    avatarUrl: s.avatar_url ?? undefined,
    hasPin: !!(s as { has_pin?: boolean }).has_pin,
  }))

  let activeStaff = staffItems.find((s) => s.id === activeStaffId) ?? null
  if (!activeStaff && staffItems.length > 0) {
    activeStaff = staffItems.find((s) => s.id === user.id) ?? staffItems[0]
  }

  const sessionData = {
    userId: user.id,
    staffList: staffItems,
    activeStaff,
    activeStaffId: activeStaff?.id ?? null,
    locale,
    orgName: orgSettings?.salon_name ?? null,
  }

  return (
    <SessionProvider data={sessionData}>
      <NotificationsProvider
        feed={notificationFeed}
        staffId={activeStaff?.id ?? null}
      >
      {/* h-dvh (dynamic viewport height) keeps the bottom nav inside the
          visible viewport on iOS Safari + in-app browsers (Discord/Twitter/
          Slack), whose chrome would otherwise occlude a fixed bottom-0
          element. Bottom nav is now in flex flow rather than fixed so it
          always rides the visible bottom edge, no swipe-to-reveal needed. */}
      <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-bg)]">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <main className="relative flex-1 overflow-y-auto bg-[var(--color-bg)]">
            {/* Mobile-only sticky top bar — back arrow + page
             *  title + notification bell. Replaces the per-page
             *  centered title bars that used to live in each
             *  view, giving every mobile screen a consistent
             *  app-chrome surface. md:hidden so the sidebar owns
             *  the chrome on desktop. */}
            <MobileHeader stores={visibleStores} activeStoreId={switcherActiveStore} />
            {/* No horizontal padding here — matches the spike's
             *  (app) layout which provides ZERO padding. Each page
             *  component owns its own `px-4 md:px-6` (or whatever
             *  pattern matches the spike for that page). This is the
             *  system-wide padding rule:
             *
             *    Layout = vertical-only padding.
             *    Pages  = own horizontal padding per spike.
             *    Cards  = own `p-4` internal content padding.
             *
             *  Cards' BORDERS then sit at the page-wrapper edge (or at
             *  viewport edge on pages like karute-customer-detail
             *  which intentionally have no wrapper padding so cards
             *  bleed full-width on mobile). Card CONTENT sits at
             *  page-padding + card-padding (16+16=32px). Matches the
             *  spike's per-page screenshots exactly. */}
            <div className="mx-auto max-w-7xl py-4 md:py-6">
              {children}
            </div>
          </main>
        </div>
        <DiscreetRecordingIndicator />
        <ProcessingIndicator />
        <div className="md:hidden">
          <BottomNav nextCustomer={nextCustomer} locale={locale} />
        </div>
      </div>
      </NotificationsProvider>
    </SessionProvider>
  )
}
