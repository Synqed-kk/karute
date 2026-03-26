'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteKaruteRecord } from '@/actions/karute'
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
  const locale = useLocale()
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!window.confirm(t('deleteConfirm'))) return
    setDeleting(true)
    const result = await deleteKaruteRecord(karute.id)
    if ('error' in result) {
      toast.error(result.error)
      setDeleting(false)
    } else {
      toast.success(t('deleted'))
      router.push('/karute' as Parameters<typeof router.push>[0])
    }
  }

  // customers aliased from client_id in PostgREST query
  const customerName =
    (karute as { customers?: { name: string } | null }).customers?.name ?? '—'

  // profiles aliased from staff_profile_id in PostgREST query
  const staffName =
    (karute as { profiles?: { full_name: string } | null }).profiles?.full_name ?? '—'

  const dateSource = (karute as { session_date?: string | null }).session_date ?? karute.created_at
  const formattedDate = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(dateSource))

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border pb-4 group">
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
      <div className="ml-auto">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all disabled:opacity-50"
          aria-label="Delete karute"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
