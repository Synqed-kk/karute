import { notFound } from 'next/navigation'
import { getKaruteRecord } from '@/lib/supabase/karute'
import { KaruteDetailSpikeView } from '@/components/karute/KaruteDetailSpikeView'
import {
  karuteToHeader,
  karuteEntriesToTimeline,
  karuteSummaryToBullets,
} from '@/lib/adapters/karute-detail'

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
  const entries = karuteEntriesToTimeline(karute)
  const summaryBullets = karuteSummaryToBullets(karute)
  const transcript =
    (karute as unknown as { transcript?: string | null }).transcript ?? null

  return (
    <KaruteDetailSpikeView
      customerId={customerId}
      header={header}
      entries={entries}
      summaryBullets={summaryBullets}
      transcript={transcript}
    />
  )
}
