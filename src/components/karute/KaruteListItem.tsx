'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { deleteKaruteRecord } from '@/actions/karute'

interface KaruteListItemProps {
  id: string
  customerName: string
  createdAt: string
  entryCount: number
  summary: string | null
  locale: string
}

export function KaruteListItem({
  id,
  customerName,
  createdAt,
  entryCount,
  summary,
  locale,
}: KaruteListItemProps) {
  const [deleted, setDeleted] = useState(false)

  const date = new Date(createdAt).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  const summaryPreview =
    summary && summary.length > 80 ? summary.slice(0, 80) + '…' : summary ?? ''

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const result = await deleteKaruteRecord(id)
    if ('error' in result) {
      toast.error(result.error)
    } else {
      toast.success('Karute deleted')
      setDeleted(true)
    }
  }

  if (deleted) return null

  return (
    <Link
      href={`/${locale}/karute/${id}`}
      className="group block rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{customerName}</p>
          {summaryPreview && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{summaryPreview}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex flex-col items-end gap-1">
            <span className="text-sm text-muted-foreground">{date}</span>
            <span className="text-xs text-muted-foreground">
              {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleDelete}
            className="shrink-0 p-1.5 rounded-md text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-red-500 hover:!bg-red-500/10 transition-all"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </Link>
  )
}
