import { BottomNav } from '@/components/layout/bottom-nav'
import { Sidebar } from '@/components/layout/sidebar'
import { AIChatFAB } from '@/components/ai/AIChatFAB'
import { MiniRecorder } from '@/components/recording/MiniRecorder'
import { getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { SessionProvider } from '@/providers/session-provider'

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
  const [{ data: { user }, error }, staffList, activeStaffId, orgSettings] = await Promise.all([
    supabase.auth.getUser(),
    getStaffList(),
    getCurrentUserStaffId(),
    getOrgSettings(),
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
      {/* h-dvh (dynamic viewport height) keeps the bottom nav inside the
          visible viewport on iOS Safari + in-app browsers (Discord/Twitter/
          Slack), whose chrome would otherwise occlude a fixed bottom-0
          element. Bottom nav is now in flex flow rather than fixed so it
          always rides the visible bottom edge, no swipe-to-reveal needed. */}
      <div className="flex h-dvh flex-col overflow-hidden bg-[var(--color-bg)]">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <main className="relative flex-1 overflow-y-auto bg-[var(--color-bg)]">
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
        <MiniRecorder />
        <AIChatFAB locale={locale} />
        <div className="md:hidden">
          <BottomNav />
        </div>
      </div>
    </SessionProvider>
  )
}
