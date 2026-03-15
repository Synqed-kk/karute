import { createClient } from '@/lib/supabase/server'
import { getStaffList, getActiveStaffId } from '@/lib/staff'
import { DashboardClient } from '@/components/dashboard/DashboardClient'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()

  const staffList = await getStaffList()
  const activeStaffId = await getActiveStaffId()

  const staff = staffList.map((s) => ({
    id: s.id,
    name: s.full_name ?? 'Unknown',
    avatarInitials: (s.full_name ?? 'U').slice(0, 2).toUpperCase(),
  }))

  const { data: customersData } = await supabase
    .from('customers')
    .select('id, name')
    .order('name', { ascending: true })

  const customers: CustomerOption[] = (customersData ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }))

  return (
    <DashboardClient
      staff={staff}
      activeStaffId={activeStaffId ?? staff[0]?.id ?? null}
      customers={customers}
      locale={locale}
    />
  )
}
