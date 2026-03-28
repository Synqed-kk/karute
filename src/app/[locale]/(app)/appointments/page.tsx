import { createClient } from '@/lib/supabase/server'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
import { DashboardClient } from '@/components/dashboard/DashboardClient'
import { getOrgSettings } from '@/actions/org-settings'
import { getAppointmentsByDate } from '@/actions/appointments'
import { getCachedCustomerList } from '@/lib/customers/cached'

export default async function AppointmentsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()

  const todayStr = new Date().toISOString().split('T')[0]
  const tzOffset = 0 // server is UTC; client will re-fetch with correct offset if needed

  // Run all queries in parallel — single round-trip
  const [{ data: { user } }, staffList, activeStaffId, orgSettings, customers, todayAppointments] = await Promise.all([
    supabase.auth.getUser(),
    getStaffList(),
    getActiveStaffId(),
    getOrgSettings(),
    getCachedCustomerList(),
    getAppointmentsByDate(todayStr, tzOffset),
  ])

  const authProfileId = user?.id ?? null

  const staff = staffList.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
    avatarInitials: (s.full_name ?? 'U').slice(0, 2).toUpperCase(),
    avatarUrl: s.avatar_url ?? undefined,
  }))

  return (
    <div className="-m-4 md:-m-6">
    <DashboardClient
      staff={staff}
      activeStaffId={activeStaffId ?? staff[0]?.id ?? null}
      authProfileId={authProfileId}
      customers={customers}
      locale={locale}
      orgSettings={orgSettings}
      initialAppointments={todayAppointments}
    />
    </div>
  )
}
