import { Sidebar } from '@/components/layout/sidebar'
import { TopBar } from '@/components/layout/top-bar'
import { StaffSwitcher } from '@/components/staff/StaffSwitcher'
import { AIChatFAB } from '@/components/ai/AIChatFAB'
import { MiniRecorder } from '@/components/recording/MiniRecorder'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
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
  const [{ data: { user }, error }, staffList, activeStaffId] = await Promise.all([
    supabase.auth.getUser(),
    getStaffList(),
    getActiveStaffId(),
  ])
  if (!user || error) {
    redirect(`/${locale}/login`)
  }

  // Normalize to simple name-keyed shape for the switcher
  const staffItems = staffList.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
    displayRole: (s as { display_role?: string }).display_role ?? 'staff',
    avatarUrl: s.avatar_url ?? undefined,
    hasPin: !!(s as { pin_hash?: string | null }).pin_hash,
  }))

  // Resolve active staff from cookie, falling back to the auth user's own profile
  let activeStaff = staffItems.find((s) => s.id === activeStaffId) ?? null

  if (!activeStaff && staffItems.length > 0) {
    // No cookie or cookie ID not found — prefer the auth user's own profile (owner),
    // then fall back to first alphabetical member
    activeStaff = staffItems.find((s) => s.id === user.id) ?? staffItems[0]
  }

  const sessionData = {
    userId: user.id,
    staffList: staffItems,
    activeStaff,
    activeStaffId: activeStaff?.id ?? null,
    locale,
  }

  return (
    <SessionProvider data={sessionData}>
      <div className="flex h-screen flex-col overflow-hidden bg-[#e8e8e8] p-3 dark:bg-[#2a2a2a]">
        <div className="flex items-center py-1" style={{ height: '72px' }}>
          <img src="/karute_logo.png" alt="Karute" className="h-14 object-contain dark:invert" style={{ height: '100px' }} />
          <div className="ml-auto flex items-center">
            <TopBar />
            <StaffSwitcher staffList={staffItems} activeStaff={activeStaff} authProfileId={user.id} />
          </div>
        </div>
        <div className="flex flex-1 gap-3 min-h-0 overflow-hidden">
          <div className="relative max-sm:w-0">
            <Sidebar />
          </div>
          <main className="relative flex-1 overflow-y-auto rounded-[28px] bg-[#e0e0e0] dark:bg-[#3a3a3a]">
            <div className="mx-auto max-w-7xl p-4 md:p-6">
              {children}
            </div>
          </main>
        </div>
        <MiniRecorder />
        <AIChatFAB locale={locale} />
      </div>
    </SessionProvider>
  )
}
