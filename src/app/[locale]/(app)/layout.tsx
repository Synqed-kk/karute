import { Sidebar } from '@/components/layout/sidebar'
import { TopBar } from '@/components/layout/top-bar'
import { StaffSwitcher } from '@/components/staff/StaffSwitcher'
import { getStaffList, getActiveStaffId } from '@/lib/staff'

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
  const { data: { user }, error } = await supabase.auth.getUser()
  if (!user || error) {
    redirect(`/${locale}/login`)
  }

  const staffList = await getStaffList()

  // Normalize to simple name-keyed shape for the switcher
  const staffItems = staffList.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
  }))

  // Resolve active staff from cookie, falling back to first alphabetical member
  const activeStaffId = await getActiveStaffId()
  let activeStaff = staffItems.find((s) => s.id === activeStaffId) ?? null

  if (!activeStaff && staffItems.length > 0) {
    // No cookie or cookie ID not found — auto-select first alphabetical member
    // Cookie will be set by StaffSwitcher on client mount (can't set cookies during render)
    activeStaff = staffItems[0]
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#e8e8e8] p-3 dark:bg-[#2a2a2a]">
      <div className="flex items-center justify-end px-4 py-1">
        <TopBar />
        <StaffSwitcher staffList={staffItems} activeStaff={activeStaff} authProfileId={user.id} />
      </div>
      <div className="flex flex-1 gap-3 min-h-0 overflow-hidden">
        <div className="relative">
          <Sidebar />
        </div>
        <main className="relative flex-1 overflow-y-auto rounded-[28px] bg-white dark:bg-[#3a3a3a]">
          <div className="mx-auto max-w-7xl p-4 md:p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
