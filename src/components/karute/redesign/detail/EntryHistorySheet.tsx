'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { listEntryEditHistory } from '@/actions/karute'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { SessionEntry } from './CurrentSessionCard'

interface EntryHistoryRow {
  id: string
  entryIdOld: string | null
  entryIdNew: string | null
  action: string
  actorName: string | null
  contentBefore: string | null
  contentAfter: string | null
  createdAt: string
}

interface EntryHistorySheetProps {
  karuteRecordId: string
  /** The entry whose trail is shown, or null when closed — Sheet's open
   *  state derives from this (same idiom as EntryEditSheet). */
  entry: SessionEntry | null
  onOpenChange: (open: boolean) => void
}

/** The 編集済み chip's bottom sheet (W2 history-sheet packet) — that entry's
 *  trail, newest first: editor name, timestamp, before/after text. Read-
 *  only, per-ENTRY scope (手書き stays inert — the ruling covers 編集済み
 *  only). NO self-undo / restore (PR-G, not here) and NO 「この操作は監査ログに
 *  記録されました」-style notice (design §6, same ban as EntryEditSheet). */
export function EntryHistorySheet({ karuteRecordId, entry, onOpenChange }: EntryHistorySheetProps) {
  const t = useTranslations('karuteDetail.entryHistory')
  const tc = useTranslations('common')
  const locale = useLocale()
  const [rows, setRows] = useState<EntryHistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  // Boolean on purpose — the raw server string must never render (sibling
  // convention: EntryEditSheet captures raw but renders t('error')).
  const [error, setError] = useState(false)

  const entryId = entry?.id ?? null
  useEffect(() => {
    if (!entryId) return
    let cancelled = false
    setLoading(true)
    setError(false)
    listEntryEditHistory(karuteRecordId).then((result) => {
      if (cancelled) return
      if ('error' in result) {
        setError(true)
        setRows([])
      } else {
        // Per-ENTRY scope: the karute's full trail, filtered to rows that
        // touch the tapped entry on either side of a REGEN_REPLACE-style swap.
        setRows(result.edits.filter((e) => e.entryIdNew === entryId || e.entryIdOld === entryId))
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [entryId, karuteRecordId])

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  )

  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] gap-3 overflow-y-auto p-5">
        <SheetHeader className="p-0">
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>

        {loading && <p className="text-[13px] text-muted-foreground">{tc('loading')}</p>}
        {!loading && error && <p className="text-[13px] text-red-500">{t('error')}</p>}
        {!loading && !error && rows.length === 0 && (
          <p className="text-[13px] text-muted-foreground">{t('empty')}</p>
        )}

        {!loading && !error && rows.length > 0 && (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1.5 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {row.actorName ?? t('unknownStaff')}
                  </span>
                  <span className="tabular-nums">{dateFmt.format(new Date(row.createdAt))}</span>
                </div>
                {row.contentBefore !== null && (
                  <p className="text-[13px] leading-relaxed text-muted-foreground line-through">
                    {row.contentBefore}
                  </p>
                )}
                {row.contentAfter !== null && (
                  <p className="text-[13px] leading-relaxed text-foreground">{row.contentAfter}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  )
}
