import { Sidebar } from '@/components/layout/sidebar'
import { TopBar } from '@/components/layout/top-bar'
import { StaffSwitcher } from '@/components/staff/StaffSwitcher'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
import { setActiveStaff } from '@/actions/staff'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
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
    activeStaff = staffItems[0]
    // Set the cookie so subsequent requests don't repeat this resolution
    await setActiveStaff(staffItems[0].id)
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#e8e8e8] p-3 dark:bg-[#2a2a2a]">
      <div className="flex items-center justify-end px-4 py-1">
        <TopBar />
        <StaffSwitcher staffList={staffItems} activeStaff={activeStaff} />
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
