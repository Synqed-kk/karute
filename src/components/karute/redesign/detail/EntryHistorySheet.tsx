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
  action: string | null
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

/** ONE keyed view, not three independent booleans (fix round, fleet review):
 *  `entryId` pins a fetch result to the entry it was fetched FOR. The render
 *  only trusts a view whose entryId matches the CURRENT entry — a stale
 *  result from the entry that was open a moment ago can never paint (no
 *  flash of A's rows while B is loading, no empty-state flash before the
 *  first-ever fetch resolves — a null view always means "loading"). */
type HistoryView = {
  entryId: string
  status: 'ok' | 'error'
  rows: EntryHistoryRow[]
  truncated: boolean
} | null

/** The 編集済み chip's bottom sheet (W2 history-sheet packet) — that entry's
 *  trail, newest first: editor name, timestamp, before/after text. Read-
 *  only, per-ENTRY scope (手書き stays inert — the ruling covers 編集済み
 *  only). NO self-undo / restore (PR-G, not here) and NO 「この操作は監査ログに
 *  記録されました」-style notice (design §6, same ban as EntryEditSheet). */
export function EntryHistorySheet({ karuteRecordId, entry, onOpenChange }: EntryHistorySheetProps) {
  const t = useTranslations('karuteDetail.entryHistory')
  const tc = useTranslations('common')
  const locale = useLocale()
  const [view, setView] = useState<HistoryView>(null)

  const entryId = entry?.id ?? null
  useEffect(() => {
    if (!entryId) return
    // Clear a SAME-id cached view synchronously, before the fetch below —
    // the keyed-view check already blocks a stale DIFFERENT entry's rows
    // from painting, but a reopen of the same entry matches it trivially and
    // would otherwise flash last time's rows for a frame (fix round 2,
    // delta-verify). One pre-effect-commit frame of the entry's own
    // previous rows, before this clear lands, is accepted as benign.
    setView((prev) => (prev?.entryId === entryId ? null : prev))
    let cancelled = false
    const run = async () => {
      // try/catch belt: a throwing server-action RPC (transport rejection)
      // must not strand the sheet in its loading state forever — same #615
      // precedent as EntryEditSheet's save() (EntryEditSheet.tsx:71-86).
      let result: Awaited<ReturnType<typeof listEntryEditHistory>>
      try {
        result = await listEntryEditHistory(karuteRecordId)
      } catch {
        if (!cancelled) setView({ entryId, status: 'error', rows: [], truncated: false })
        return
      }
      if (cancelled) return
      if ('error' in result) {
        setView({ entryId, status: 'error', rows: [], truncated: false })
      } else {
        setView({
          entryId,
          status: 'ok',
          // Per-ENTRY scope: the karute's full trail, filtered to rows that
          // touch the tapped entry on either side of a REGEN_REPLACE-style
          // swap.
          rows: result.edits.filter((e) => e.entryIdNew === entryId || e.entryIdOld === entryId),
          truncated: result.truncated,
        })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [entryId, karuteRecordId])

  // Only a view fetched FOR the entry that's open right now may render.
  const v = view?.entryId === entryId ? view : null

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
  // new Date + Intl.format throws on an invalid string — guard so one bad
  // timestamp can't blank the whole sheet; the row still renders, just
  // without a time.
  const formatCreatedAt = (iso: string): string | null => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : dateFmt.format(d)
  }

  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] gap-3 overflow-y-auto p-5">
        <SheetHeader className="p-0">
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>

        {!v && <p className="text-[13px] text-muted-foreground">{tc('loading')}</p>}
        {v?.status === 'error' && <p className="text-[13px] text-red-500">{t('error')}</p>}
        {v?.status === 'ok' && v.rows.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            {/* The chip only shows on an entry that HAS edits — a filtered-
                empty result while truncated means rows may be sitting past
                the cap, never "no history" (T3 fleet finding). */}
            {v.truncated ? t('partial') : t('empty')}
          </p>
        )}

        {v?.status === 'ok' && v.rows.length > 0 && (
          <>
            <ul className="flex flex-col gap-3">
              {v.rows.map((row) => {
                const ts = formatCreatedAt(row.createdAt)
                return (
                  <li key={row.id} className="flex flex-col gap-1.5 rounded-xl border border-border p-3">
                    <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {row.actorName ?? t('unknownStaff')}
                      </span>
                      {ts && <span className="tabular-nums">{ts}</span>}
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
                )
              })}
            </ul>
            {v.truncated && (
              <p className="text-[11.5px] text-muted-foreground">{t('partial')}</p>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
