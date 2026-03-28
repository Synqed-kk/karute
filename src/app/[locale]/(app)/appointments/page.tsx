import { createClient } from '@/lib/supabase/server'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
import { DashboardClient } from '@/components/dashboard/DashboardClient'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import { getOrgSettings } from '@/actions/org-settings'

export default async function AppointmentsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()

  // Run all queries in parallel — single round-trip
  const [{ data: { user } }, staffList, activeStaffId, orgSettings, { data: customersData }] = await Promise.all([
    supabase.auth.getUser(),
    getStaffList(),
    getActiveStaffId(),
    getOrgSettings(),
    supabase.from('customers').select('id, name').order('name', { ascending: true }),
  ])

  const authProfileId = user?.id ?? null

  const staff = staffList.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
    avatarInitials: (s.full_name ?? 'U').slice(0, 2).toUpperCase(),
    avatarUrl: s.avatar_url ?? undefined,
  }))

  const customers: CustomerOption[] = (customersData ?? []).map((c) => ({
    id: c.id,
    name: c.name,
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
    />
    </div>
  )
}
