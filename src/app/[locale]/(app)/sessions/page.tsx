import { createClient } from '@/lib/supabase/server'
import { getActiveStaffId } from '@/lib/staff'
import { RecordingFlow } from '@/components/recording/RecordingFlow'
import { getCachedCustomerList } from '@/lib/customers/cached'

export default async function SessionsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()

  // Parallel: customers (cached) + activeStaffId
  const [customers, activeStaffId] = await Promise.all([
    getCachedCustomerList(),
    getActiveStaffId(),
  ])

  // Fetch next unlinked appointment (depends on activeStaffId)
  let nextAppointment: {
    id: string
    customerName: string
    customerId: string
    startTime: string
    durationMinutes: number
    title: string | null
    notes: string | null
  } | null = null

  if (activeStaffId) {
    const now = new Date()
    const windowStart = new Date(now.getTime() - 12 * 60 * 60 * 1000)
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: appointments } = await (supabase as any)
      .from('appointments')
      .select('id, start_time, duration_minutes, client_id, title, notes, customers:client_id ( name )')
      .is('karute_record_id', null)
      .eq('staff_profile_id', activeStaffId)
      .gte('start_time', windowStart.toISOString())
      .lte('start_time', windowEnd.toISOString())
      .order('start_time', { ascending: true })
      .limit(1)

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
  }

  return <RecordingFlow customers={customers} locale={locale} nextAppointment={nextAppointment} />
}
