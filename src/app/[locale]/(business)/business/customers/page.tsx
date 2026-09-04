// 顧客 — the computer door onto the business's customer ledger, wearing the
// ACCEPTED MOCK's own clothes (CUSTOMERS-MOCK-v1.html): the five stat tiles ARE
// the filters, the duplicate triage strip replaces the red banner, the list is a
// dense 52px page-scrolled table, and the inspector is a sectioned sticky
// column. Every truth the transplanted room proved is kept — the mock is a spec
// for layout, hierarchy, copy and motion, never a licence to drop a behaviour.
//
// Route: the (business) group adds no URL segment, and /[locale] +
// /[locale]/customers are already the phone app's, so Business lives under a
// /business/ segment. The group layout gates too; this page re-asserts the
// admission itself (idempotent) so the screen never depends on a parent's await
// for its authorization.
//
// SERVER COMPONENT ON PURPOSE. Everything between the gate and the render lives
// in `customers-props.ts` (the room-3 F1 law), so the evidence harness renders
// the SAME assembly this route does rather than a hand-written replica of it.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { CustomersScreen } from './CustomersScreen'
import { customersProps } from './customers-props'
import './customers.css'

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, { store }] = await Promise.all([params, searchParams])
  const { props } = await customersProps({ locale, store })

  return <CustomersScreen {...props} />
}
