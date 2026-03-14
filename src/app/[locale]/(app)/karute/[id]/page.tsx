import { notFound } from 'next/navigation'
import { getKaruteRecord } from '@/lib/supabase/karute'
import { KaruteDetailView } from '@/components/karute/KaruteDetailView'

interface KaruteDetailPageProps {
  params: Promise<{ id: string; locale: string }>
}

/**
 * Karute record detail page.
 * Server component — fetches the karute record with nested customer and entries.
 * Renders the two-column KaruteDetailView.
 */
export default async function KaruteDetailPage({
  params,
}: KaruteDetailPageProps) {
  const { id } = await params

  const karute = await getKaruteRecord(id)

  if (!karute) {
    notFound()
  }

  return <KaruteDetailView karute={karute} />
}
