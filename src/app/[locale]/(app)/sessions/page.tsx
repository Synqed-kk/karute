import { createClient } from '@/lib/supabase/server'
import { getActiveStaffId } from '@/lib/staff'
import { RecordingFlow } from '@/components/recording/RecordingFlow'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const activeStaffId = await getActiveStaffId()

  const { data: customersData } = await supabase
    .from('customers')
    .select('id, name')
    .order('name', { ascending: true })

  const customers: CustomerOption[] = (customersData ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }))

  // Fetch the next upcoming appointment for the active staff member
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nextAppointment: {
    id: string
    customerName: string
    customerId: string
    startTime: string
    durationMinutes: number
  } | null = null

  // Find the nearest unlinked appointment today — includes ones currently in progress
  // (start_time may be in the past but start_time + duration hasn't passed yet)
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(now)
  todayEnd.setHours(23, 59, 59, 999)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  let query = sb
    .from('appointments')
    .select('id, start_time, duration_minutes, client_id, customers:client_id ( name )')
    .is('karute_record_id', null)
    .gte('start_time', todayStart.toISOString())
    .lte('start_time', todayEnd.toISOString())
    .order('start_time', { ascending: true })

  if (activeStaffId) {
    query = query.eq('staff_profile_id', activeStaffId)
  }

  const { data: appointments } = await query.limit(1)

  if (appointments && appointments.length > 0) {
    const a = appointments[0]
    nextAppointment = {
      id: a.id,
      customerName: (a.customers as { name: string } | null)?.name ?? 'Unknown',
      customerId: a.client_id,
      startTime: a.start_time,
      durationMinutes: a.duration_minutes,
    }
  }

  return <RecordingFlow customers={customers} locale={locale} nextAppointment={nextAppointment} />
}
