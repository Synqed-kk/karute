import { notFound } from 'next/navigation'
import { Link } from '@/i18n/navigation'
import { ChevronLeft } from 'lucide-react'
import { getKaruteRecord } from '@/lib/supabase/karute'
import { KaruteDetailView } from '@/components/karute/KaruteDetailView'

interface KaruteDetailPageProps {
  params: Promise<{ id: string; locale: string }>
}

export default async function KaruteDetailPage({
  params,
}: KaruteDetailPageProps) {
  const { id } = await params

  const karute = await getKaruteRecord(id)

  if (!karute) {
    notFound()
  }

  return (
    <div>
      <Link
        href={'/dashboard' as Parameters<typeof Link>[0]['href']}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        Dashboard
      </Link>
      <KaruteDetailView karute={karute} />
    </div>
  )
}
