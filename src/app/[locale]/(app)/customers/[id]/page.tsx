import { notFound } from 'next/navigation'
import { getSynqedClient } from '@/lib/synqed/client'
import { getCustomer } from '@/lib/customers/queries'
import { CustomerDetailView } from '@/components/customers/CustomerDetailView'
import {
  customerToIdentityProps,
  appointmentsToSessionItems,
  type AppointmentLike,
  type StaffNameMap,
} from '@/lib/adapters/customer-detail'

interface CustomerProfilePageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function CustomerProfilePage({
  params,
}: CustomerProfilePageProps) {
  const { id } = await params

  const customer = await getCustomer(id).catch(() => null)
  if (!customer) notFound()

  const synqed = await getSynqedClient()
  const [apptList, staffList] = await Promise.all([
    synqed.appointments.list({ customer_id: id, page_size: 500 }).catch(() => null),
    synqed.staff.list({ page_size: 200 }).catch(() => null),
  ])

  const appointments = (apptList?.appointments ?? []) as AppointmentLike[]
  // synqed-core returns ascending by default in some endpoints; ensure newest first
  appointments.sort(
    (a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime(),
  )

  const staffNames: StaffNameMap = {}
  for (const s of staffList?.staff ?? []) {
    staffNames[s.id] = s.name
  }

  const visitCount = appointments.length
  const lastVisit = appointments[0]?.starts_at ?? null
  const staffName = appointments[0]
    ? staffNames[appointments[0].staff_id] ?? '—'
    : '—'

  const identity = customerToIdentityProps(customer, visitCount, lastVisit, staffName)
  const sessions = appointmentsToSessionItems(appointments, staffNames)

  return (
    <CustomerDetailView
      identity={identity}
      sessions={sessions}
      contact={{
        phone: customer.phone ?? null,
        email: customer.email ?? null,
        furigana: customer.furigana ?? null,
      }}
      notes={customer.notes}
    />
  )
}
