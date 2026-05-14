import { notFound } from 'next/navigation'

import { getKaruteRecord } from '@/lib/supabase/karute'
import { createClient } from '@/lib/supabase/server'
import { KaruteDetailView } from '@/components/karute/redesign/detail/KaruteDetailView'
import {
  karuteToHeader,
  karuteEntriesToSessionEntries,
  karuteSummaryToBullets,
  deriveKaruteNumber,
} from '@/lib/adapters/karute-detail'
import {
  listCustomerPhotos,
  getCustomerConsent,
} from '@/actions/customers'

interface KaruteDetailPageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function KaruteDetailPage({
  params,
}: KaruteDetailPageProps) {
  const { id } = await params

  const karute = await getKaruteRecord(id)
  if (!karute) notFound()

  const customerId =
    (karute as unknown as { client_id?: string | null }).client_id ?? null
  const header = karuteToHeader(karute)
  const sessionEntries = karuteEntriesToSessionEntries(karute)
  const summaryBullets = karuteSummaryToBullets(karute)
  const transcript =
    (karute as unknown as { transcript?: string | null }).transcript ?? null
  const karuteNumber = deriveKaruteNumber(id)

  // Customer contact details (phone/email) — fetched separately because the
  // base karute query only joins {id, name} for the embedded customer.
  let phone: string | null = null
  let email: string | null = null
  if (customerId) {
    const supabase = await createClient()
    const { data: customer } = await supabase
      .from('customers')
      .select('phone, email')
      .eq('id', customerId)
      .maybeSingle()
    phone = customer?.phone ?? null
    email = customer?.email ?? null
  }

  // Photos and consent in parallel (both gated on customerId).
  const [photosResult, consentResult] = customerId
    ? await Promise.all([
        listCustomerPhotos(customerId).catch(() => ({ photos: [] })),
        getCustomerConsent(customerId).catch(() => ({ consent: null })),
      ])
    : [{ photos: [] }, { consent: null }]

  const photos = (photosResult.photos ?? []).map((p) => ({
    id: p.id,
    signedUrl: p.signed_url,
    category: p.category,
    caption: p.caption,
  }))
  const consentOnFile = Boolean(
    (consentResult as { consent?: unknown }).consent,
  )

  return (
    <KaruteDetailView
      karuteId={id}
      customerId={customerId}
      header={{
        customerName: header.customerName,
        initials: header.customerInitials,
        karuteNumber,
        service: null,
        sessionDateLong: header.sessionDateLong,
        staffName: header.staffName === '—' ? null : header.staffName,
        phone,
        email,
      }}
      sessionDateLong={header.sessionDateLong}
      entries={sessionEntries}
      summaryBullets={summaryBullets}
      transcript={transcript}
      consentOnFile={consentOnFile}
      transcriptDurationLabel={null}
      photos={photos}
      memory={null}
      bodyPrediction={null}
      suggestedMessage={null}
    />
  )
}
