'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { updateKaruteDetailEntry, listEntryEditHistory } from '@/actions/karute'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { CATEGORY_ORDER, type SessionCategory, type SessionEntry } from './CurrentSessionCard'

interface EntryEditSheetProps {
  karuteRecordId: string
  /** The entry being edited, or null when closed — Sheet's open state derives from this. */
  entry: SessionEntry | null
  onOpenChange: (open: boolean) => void
  /** Fired on a successful save (edit-layer W2 PR-B fleet fix) — version is
   *  expectedVersion + 1, body/category are what was actually sent (unchanged
   *  fields fall back to the seeded values). Lets the card apply an optimistic
   *  override so a re-click before the next fetch lands re-seeds the sheet
   *  with the just-saved content instead of the stale prop. */
  onSaved?: (saved: {
    entryId: string
    body: string
    category: SessionCategory
    version: number
    author: NonNullable<SessionEntry['author']>
  }) => void
}

// --- 編集履歴 block (W2 one-sheet consolidation, 2026-07-26 mock) — the
// deleted EntryHistorySheet.tsx's row-rendering and fetch idioms, moved in
// verbatim. Fetches + renders ONLY for a human-touched entry; a plain AI
// entry gets no block and no fetch (its trail is pipeline noise, and it
// saves a round-trip). No 編集済み badge anywhere anymore — the amber pencil
// (CurrentSessionCard) is the only edited-state signal now. ---

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

/** The pencil's bottom sheet (edit-layer W2 PR-B, mock frame 1; W2 one-sheet
 *  consolidation folds the history sheet in above the chips). Seeded
 *  textarea + category chips + save, CAS-guarded via entry.version. EDIT-SAVE
 *  ONLY: no delete (PR-B2), no self-undo/restore, and no 「記録されます」-style
 *  notice (design §6). Close-on-save is unchanged. */
export function EntryEditSheet({
  karuteRecordId,
  entry,
  onOpenChange,
  onSaved,
}: EntryEditSheetProps) {
  const t = useTranslations('karuteDetail.entryEdit')
  const tCat = useTranslations('karuteDetail.currentSession.categories')
  const tHist = useTranslations('karuteDetail.entryHistory')
  const tc = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<SessionCategory | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  // Boolean on purpose — the raw server string must never render (sibling
  // convention: RegenerateEntriesButton captures raw but renders t('error')).
  const [error, setError] = useState(false)
  const [view, setView] = useState<HistoryView>(null)

  // Reseed only when a NEW entry opens — a re-render mid-edit must not clobber it.
  useEffect(() => {
    if (entry) {
      setContent(entry.body)
      setCategory(entry.category)
      setConflict(false)
      setError(false)
    }
  }, [entry])

  const entryId = entry?.id ?? null
  const humanTouched = entry?.author === 'HUMAN_EDITED' || entry?.author === 'HUMAN_CREATED'
  // History fetch — keyed-view + cancelled + try/catch idioms carried over
  // UNCHANGED from the deleted EntryHistorySheet. Gate on humanTouched (a
  // primitive, not the `entry` object) so a parent re-render that hands down
  // a same-content-but-new-reference entry object can't spuriously refire it.
  useEffect(() => {
    if (!entryId || !humanTouched) return
    // Clear a SAME-id cached view synchronously, before the fetch below —
    // the keyed-view check already blocks a stale DIFFERENT entry's rows
    // from painting, but a reopen of the same entry matches it trivially and
    // would otherwise flash last time's rows for a frame.
    setView((prev) => (prev?.entryId === entryId ? null : prev))
    let cancelled = false
    const run = async () => {
      // try/catch belt: a throwing server-action RPC (transport rejection)
      // must not strand the block in its loading state forever (#615
      // precedent, same as save() below).
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
  }, [entryId, humanTouched, karuteRecordId])

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
  // timestamp can't blank the block, the row still renders, just without a time.
  const formatCreatedAt = (iso: string): string | null => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : dateFmt.format(d)
  }

  const save = async () => {
    if (!entry || entry.version === undefined) return
    const effectiveCategory = category ?? entry.category
    // No-op guard — nothing changed → close, no call, no version bump, no
    // spine noise (entry is already the merged/post-save view from the card).
    if (content === entry.body && effectiveCategory === entry.category) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    setError(false)
    // try/finally so a THROWING action (vs a returned {error}) can never
    // strand the sheet in its saving state — belt on top of the port's own
    // catch (Greptile P1, #615).
    let result: Awaited<ReturnType<typeof updateKaruteDetailEntry>>
    try {
      result = await updateKaruteDetailEntry(karuteRecordId, entry.id, {
        content: content !== entry.body ? content : undefined,
        category: effectiveCategory !== entry.category ? effectiveCategory : undefined,
        expectedVersion: entry.version,
      })
    } catch {
      setError(true)
      return
    } finally {
      setSaving(false)
    }
    if ('conflict' in result) {
      setConflict(true)
      return
    }
    if ('error' in result) {
      setError(true)
      return
    }
    onSaved?.({
      entryId: entry.id,
      body: content,
      category: effectiveCategory,
      version: entry.version + 1,
      // Mirror core's author rule (updateEntry: substantive edit flips AI →
      // HUMAN_EDITED, human authors keep theirs) so the amber pencil shows
      // the moment the save lands, not a refresh later.
      author: entry.author === 'AI' || entry.author === undefined ? 'HUMAN_EDITED' : entry.author,
    })
    router.refresh()
    onOpenChange(false)
  }

  // Never retry the CAS — reload re-fetches instead of resending the stale version.
  const reload = () => {
    router.refresh()
    onOpenChange(false)
  }

  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] gap-3 overflow-y-auto p-5">
        <SheetHeader className="p-0">
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>

        {humanTouched && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">{tHist('title')}</span>
            <div className="max-h-32 overflow-y-auto rounded-xl border border-border p-3">
              {!v && <p className="text-[13px] text-muted-foreground">{tc('loading')}</p>}
              {v?.status === 'error' && <p className="text-[13px] text-red-500">{tHist('error')}</p>}
              {v?.status === 'ok' && v.rows.length === 0 && (
                <p className="text-[13px] text-muted-foreground">
                  {v.truncated ? tHist('partial') : tHist('empty')}
                </p>
              )}
              {v?.status === 'ok' && v.rows.length > 0 && (
                <>
                  <ul className="flex flex-col gap-3">
                    {v.rows.map((row) => {
                      const ts = formatCreatedAt(row.createdAt)
                      return (
                        <li key={row.id} className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {row.actorName ?? tHist('unknownStaff')}
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
                    <p className="mt-2 text-[11.5px] text-muted-foreground">{tHist('partial')}</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'h-[26px] rounded-full border px-3 text-[11.5px] font-semibold transition-colors',
                category === c
                  ? 'border-foreground/30 bg-foreground/10 text-foreground'
                  : 'border-border bg-muted text-muted-foreground',
              )}
            >
              {tCat(c)}
            </button>
          ))}
        </div>

        <textarea
          // Fix round: only autofocus when there's no history block above it
          // — the native focus-scroll on open can push a variable-height
          // block out of view on a short viewport, defeating the design
          // intent (history visible above the editor for a human-touched
          // entry). A plain AI entry has no block, so the keyboard-on-tap
          // behavior is unchanged there.
          autoFocus={!humanTouched}
          value={content}
          onChange={(evt) => setContent(evt.target.value)}
          rows={4}
          maxLength={4000}
          className="w-full resize-none rounded-2xl border border-foreground/70 p-3 text-sm leading-relaxed text-foreground focus:outline-none"
        />

        {conflict && (
          <div className="flex items-center justify-between rounded-xl bg-amber-500/10 p-3 text-[13px] text-amber-700 dark:text-amber-400">
            <span>{t('conflict')}</span>
            <button type="button" onClick={reload} className="font-semibold underline">
              {t('reload')}
            </button>
          </div>
        )}
        {error && <p className="text-[13px] text-red-500">{t('error')}</p>}

        <div className="flex items-center justify-end pt-1">
          <button
            type="button"
            onClick={save}
            disabled={
              saving ||
              conflict ||
              // Only an ACTIVE emptying blocks — an unchanged empty body is
              // never sent, so a category-only fix on an already-empty row
              // (other write paths don't bound content) stays possible.
              (entry !== null && content !== entry.body && content.trim() === '')
            }
            className="rounded-full bg-foreground px-8 py-2.5 text-sm font-semibold text-background disabled:opacity-50"
          >
            {t('save')}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
