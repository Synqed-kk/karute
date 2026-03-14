import { useTranslations } from 'next-intl'
import type { KaruteWithRelations } from '@/lib/supabase/karute'

interface KaruteHeaderProps {
  karute: KaruteWithRelations
}

/**
 * Header bar for the karute detail view.
 * Displays customer name, date, and staff name.
 * Per user decision: no avatar/photo.
 */
export function KaruteHeader({ karute }: KaruteHeaderProps) {
  const t = useTranslations('karute')

  // customers aliased from client_id in PostgREST query
  const customerName =
    (karute as { customers?: { name: string } | null }).customers?.name ?? '—'

  // profiles aliased from staff_profile_id in PostgREST query
  const staffName =
    (karute as { profiles?: { full_name: string } | null }).profiles?.full_name ?? '—'

  const dateSource = (karute as { session_date?: string | null }).session_date ?? karute.created_at
  const formattedDate = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(dateSource))

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border pb-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t('customer')}
        </p>
        <p className="text-lg font-semibold text-foreground">{customerName}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t('date')}
        </p>
        <p className="text-sm text-foreground">{formattedDate}</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {t('staff')}
        </p>
        <p className="text-sm text-foreground">{staffName}</p>
      </div>
    </div>
  )
}
