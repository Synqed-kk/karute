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
import { getStaffList } from '@/lib/staff'
import { getActiveStaffId } from '@/lib/active-staff'
import { getOrgSettings } from '@/actions/org-settings'
import { getNextCustomer } from '@/lib/appointments/next-customer'
import { SessionProvider } from '@/providers/session-provider'
import { TopBar } from '@/components/layout/top-bar'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  const supabase = await createClient()
  const [{ data: { user }, error }, staffList, activeStaffId, orgSettings, nextCustomer] = await Promise.all([
    supabase.auth.getUser(),
    getStaffList(),
    getActiveStaffId(),
    getOrgSettings(),
    // Bottom-nav next-customer label. Fanned out in parallel with
    // the other layout queries so it doesn't add a serial step.
    // Failure is non-fatal — bottom nav falls back to its scaffold
    // copy ("予約を選択") if this query errors.
    getNextCustomer().catch(() => null),
  ])
  if (!user || error) {
    redirect(`/${locale}/login`)
  }

  const staffItems = staffList.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
    displayRole: (s as { display_role?: string }).display_role ?? 'staff',
    avatarUrl: s.avatar_url ?? undefined,
    hasPin: !!(s as { has_pin?: boolean }).has_pin,
  }))

  const activeStaff = staffItems.find((s) => s.id === activeStaffId) ?? null

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
      {/* h-dvh (dynamic viewport height) keeps the bottom nav inside the
          visible viewport on iOS Safari + in-app browsers (Discord/Twitter/
          Slack), whose chrome would otherwise occlude a fixed bottom-0
          element. Bottom nav is now in flex flow rather than fixed so it
          always rides the visible bottom edge, no swipe-to-reveal needed. */}
      <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-bg)]">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <main className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
            {/* Staff switcher chip (PIN-gated active staff) — desktop + mobile. */}
            <TopBar />
            {/* Mobile-only sticky chrome — back arrow + page title + bell.
             *  md:hidden so the sidebar owns the chrome on desktop. */}
            <MobileHeader />
            <div className="flex-1 overflow-y-auto">
              {/* No horizontal padding here — the spike's (app) layout provides
               *  vertical-only padding; each page owns its own px-* per the
               *  spike. Cards own their internal p-4. */}
              <div className="mx-auto max-w-7xl py-4 md:py-6">{children}</div>
            </div>
          </main>
        </div>
        <DiscreetRecordingIndicator />
        <div className="md:hidden">
          <BottomNav nextCustomer={nextCustomer} locale={locale} />
        </div>
      </div>
    </SessionProvider>
  )
}
