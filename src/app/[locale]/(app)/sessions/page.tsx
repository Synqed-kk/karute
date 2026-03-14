import { createClient } from '@/lib/supabase/server'
import { RecordingFlow } from '@/components/recording/RecordingFlow'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'

/**
 * Sessions page — the entry point for recording a new karute session.
 *
 * Server component: pre-fetches the customer list so the save step
 * (ReviewConfirmStep → SaveKaruteFlow) doesn't need a client-side fetch.
 *
 * The full flow lives inside RecordingFlow (client component):
 *   Record → AI Pipeline → Review → Save
 */
export default async function SessionsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()

  const { data: customersData } = await supabase
    .from('customers')
    .select('id, name')
    .order('name', { ascending: true })

  const customers: CustomerOption[] = (customersData ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }))

  return <RecordingFlow customers={customers} locale={locale} />
}
