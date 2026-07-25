'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { updateKaruteDetailEntry } from '@/actions/karute'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { CATEGORY_ORDER, type SessionCategory, type SessionEntry } from './CurrentSessionCard'

interface EntryEditSheetProps {
  karuteRecordId: string
  /** Threaded through to the save call for the choke-point audit's
   *  customer_id detail (ids only, never displayed). */
  customerId?: string | null
  /** The entry being edited, or null when closed — Sheet's open state derives from this. */
  entry: SessionEntry | null
  onOpenChange: (open: boolean) => void
  /** Fired on a successful save (edit-layer W2 PR-B fleet fix) — version is
   *  expectedVersion + 1, body/category are what was actually sent (unchanged
   *  fields fall back to the seeded values). Lets the card apply an optimistic
   *  override so a re-click before the next fetch lands re-seeds the sheet
   *  with the just-saved content instead of the stale prop. */
  onSaved?: (saved: { entryId: string; body: string; category: SessionCategory; version: number }) => void
}

/** The pencil's bottom sheet (edit-layer W2 PR-B, mock frame 1) — seeded
 *  textarea + category chips + save, CAS-guarded via entry.version. EDIT-SAVE
 *  ONLY: no delete (PR-B2) and no 「記録されます」-style notice (design §6). */
export function EntryEditSheet({
  karuteRecordId,
  customerId,
  entry,
  onOpenChange,
  onSaved,
}: EntryEditSheetProps) {
  const t = useTranslations('karuteDetail.entryEdit')
  const tCat = useTranslations('karuteDetail.currentSession.categories')
  const router = useRouter()
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<SessionCategory | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reseed only when a NEW entry opens — a re-render mid-edit must not clobber it.
  useEffect(() => {
    if (entry) {
      setContent(entry.body)
      setCategory(entry.category)
      setConflict(false)
      setError(null)
    }
  }, [entry])

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
    setError(null)
    const result = await updateKaruteDetailEntry(karuteRecordId, entry.id, {
      content: content !== entry.body ? content : undefined,
      category: effectiveCategory !== entry.category ? effectiveCategory : undefined,
      expectedVersion: entry.version,
      customerId,
    })
    setSaving(false)
    if ('conflict' in result) {
      setConflict(true)
      return
    }
    if ('error' in result) {
      setError(result.error)
      return
    }
    onSaved?.({ entryId: entry.id, body: content, category: effectiveCategory, version: entry.version + 1 })
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
          autoFocus
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
        {error && <p className="text-[13px] text-red-500">{error}</p>}

        <div className="flex items-center justify-end pt-1">
          <button
            type="button"
            onClick={save}
            disabled={saving || conflict || content.trim() === ''}
            className="rounded-full bg-foreground px-8 py-2.5 text-sm font-semibold text-background disabled:opacity-50"
          >
            {t('save')}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
