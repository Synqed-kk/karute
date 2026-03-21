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
    title: string | null
    notes: string | null
  } | null = null

  // Find the nearest unlinked appointment — look back 12h and forward 24h
  // to handle any timezone. Server runs in UTC but appointments are in local time.
  const now = new Date()
  const windowStart = new Date(now.getTime() - 12 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  // Only look for appointments if we know which staff member is active
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let appointments: any[] | null = null
  if (activeStaffId) {
    const sb = supabase as any
    const { data } = await sb
      .from('appointments')
      .select('id, start_time, duration_minutes, client_id, title, notes, customers:client_id ( name )')
      .is('karute_record_id', null)
      .eq('staff_profile_id', activeStaffId)
      .gte('start_time', windowStart.toISOString())
      .lte('start_time', windowEnd.toISOString())
      .order('start_time', { ascending: true })
      .limit(1)
    appointments = data
  }

  if (appointments && appointments.length > 0) {
    const a = appointments[0]
    nextAppointment = {
      id: a.id,
      customerName: (a.customers as { name: string } | null)?.name ?? 'Unknown',
      customerId: a.client_id,
      startTime: a.start_time,
      durationMinutes: a.duration_minutes,
      title: a.title ?? null,
      notes: a.notes ?? null,
    }
  }

  return <RecordingFlow customers={customers} locale={locale} nextAppointment={nextAppointment} />
}
