'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { updateKaruteDetailSummary, listEntryEditHistory } from '@/actions/karute'
import { summaryTextToBullets } from '@/lib/adapters/karute-detail'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

interface SummaryEditSheetProps {
  karuteRecordId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Raw effective summary (edited ?? ai) — the whole text, edited as one
   *  block (⚖ Liam 7/29: ONE pencil, whole-section edit, NOT per-line). */
  seed: string | null
  /** True when the summary already carries a human overlay — gates the
   *  history block (an untouched AI summary has no trail worth a fetch). */
  edited: boolean
  /** Fired on a successful save — the card applies an optimistic override so
   *  a re-open before router.refresh() lands re-seeds with the just-saved
   *  text, not the stale prop (same fleet fix as EntryEditSheet's onSaved). */
  onSaved?: (savedRaw: string) => void
}

// --- 編集履歴 block — EntryEditSheet's fetch/render idioms, scoped to the
// RECORD-LEVEL trail: core logs every edited_summary change as a lineage row
// with BOTH entry ids null (karute.service.ts), so that null-null filter IS
// the summary's own history. Fetches only for an already-edited summary. ---

interface SummaryHistoryRow {
  id: string
  actorName: string | null
  contentBefore: string | null
  contentAfter: string | null
  createdAt: string
}

/** ONE keyed view (EntryEditSheet convention): `recordId` pins a fetch result
 *  to the record it was fetched FOR — a stale result can never paint, and a
 *  null view always means "loading". */
type HistoryView = {
  recordId: string
  status: 'ok' | 'error'
  rows: SummaryHistoryRow[]
  truncated: boolean
} | null

/** The 詳細記録 pencil's bottom sheet (edit-layer W2 summary half). Seeded
 *  textarea + save; writes the `edited_summary` overlay — ai_summary stays
 *  untouched underneath. EDIT-SAVE ONLY: no delete, no revert-to-AI. NO CAS
 *  (core's record update has no expected_version): last write wins, and no
 *  version is lost — core keeps a record-level lineage row per change. */
export function SummaryEditSheet({
  karuteRecordId,
  open,
  onOpenChange,
  seed,
  edited,
  onSaved,
}: SummaryEditSheetProps) {
  const t = useTranslations('karuteDetail.summaryEdit')
  const tHist = useTranslations('karuteDetail.entryHistory')
  const tc = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  // Boolean on purpose — the raw server string must never render (sibling
  // convention: EntryEditSheet renders t('error')).
  const [error, setError] = useState(false)
  const [view, setView] = useState<HistoryView>(null)
  // Keyboard-fold (EntryEditSheet convention): drives the history block's
  // folded-bar layout while the textarea has focus. Only read behind `edited`
  // below — a first-edit's autoFocus firing on open must not fold anything,
  // since there is no history block to fold.
  const [isTyping, setIsTyping] = useState(false)
  // Keyboard occlusion of the LAYOUT viewport's bottom edge — #640's fix,
  // carried over VERBATIM: the shell's WKWebView doesn't resize the layout
  // viewport when the keyboard shows, so a bottom-anchored fixed sheet mounts
  // UNDER it. visualViewport is the only geometry that sees this; the inset
  // lifts the sheet by exactly the occluded height. POSITION ONLY — the fold
  // above stays focus-driven (#621's disclosed wedge).
  const [keyboard, setKeyboard] = useState<{ inset: number; visibleHeight: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const historyBlockRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    if (!vv) return // jsdom / ancient WebView — sheet keeps its bottom-0 anchor
    const update = () => {
      // Bottom occlusion = layout height − visual height − visual top offset
      // (iOS pans the visual viewport when the focused field would sit under
      // the keyboard — the scroll listener catches that repositioning too).
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      // visibleHeight rides along for the height cap: the lifted sheet's
      // bottom edge sits exactly on the visual viewport's bottom edge, so
      // vv.height IS its full visible budget. A cap derived from the inset
      // alone would overshoot by exactly offsetTop when the viewport is
      // panned, hiding the sheet's title above the pan (Greptile #640).
      setKeyboard(inset > 0 ? { inset, visibleHeight: vv.height } : null)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setKeyboard(null)
    }
  }, [open])

  // Reseed only when the sheet OPENS — a re-render mid-edit must not clobber it.
  useEffect(() => {
    if (open) {
      setContent(seed ?? '')
      setError(false)
      setIsTyping(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed on open only
  }, [open])

  const folded = edited && isTyping
  // History fetch — keyed-view + cancelled + try/catch idioms carried over
  // from EntryEditSheet. Gate on `edited`: an untouched AI summary has no
  // record-level trail rows and no block to render.
  useEffect(() => {
    if (!open || !edited) return
    // Clear a cached view synchronously before the fetch — a reopen matches
    // the keyed check trivially and would otherwise flash last time's rows.
    setView(null)
    let cancelled = false
    const run = async () => {
      // try/catch belt: a throwing server-action RPC (transport rejection)
      // must not strand the block in its loading state forever (#615).
      let result: Awaited<ReturnType<typeof listEntryEditHistory>>
      try {
        result = await listEntryEditHistory(karuteRecordId)
      } catch {
        if (!cancelled) setView({ recordId: karuteRecordId, status: 'error', rows: [], truncated: false })
        return
      }
      if (cancelled) return
      if ('error' in result) {
        setView({ recordId: karuteRecordId, status: 'error', rows: [], truncated: false })
      } else {
        setView({
          recordId: karuteRecordId,
          status: 'ok',
          // RECORD-LEVEL scope: the karute's full trail, filtered to rows
          // that touch no entry on either side — core's summary-edit rows.
          rows: result.edits
            .filter((e) => e.entryIdNew === null && e.entryIdOld === null)
            .map((e) => ({
              id: e.id,
              actorName: e.actorName,
              contentBefore: e.contentBefore,
              contentAfter: e.contentAfter,
              createdAt: e.createdAt,
            })),
          truncated: result.truncated,
        })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [open, edited, karuteRecordId])

  // Only a view fetched FOR this record may render.
  const v = view?.recordId === karuteRecordId ? view : null

  // Folded-bar text mirrors the full block's own loading/error/empty branches
  // (EntryEditSheet's honesty rule, condensed to one line). rows[0] is the
  // latest edit — the trail view is newest-first.
  const latestRow = v?.status === 'ok' ? v.rows[0] : undefined
  const latestText = !v
    ? tc('loading')
    : v.status === 'error'
      ? tHist('error')
      : latestRow
        ? (latestRow.contentAfter ?? latestRow.contentBefore ?? '')
        : v.truncated
          ? tHist('partial')
          : tHist('empty')
  const latestTone = !v || (v.status === 'ok' && !latestRow) ? 'muted' : v.status === 'error' ? 'error' : 'content'

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
  // timestamp can't blank the block; the row still renders, just without a time.
  const formatCreatedAt = (iso: string): string | null => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : dateFmt.format(d)
  }

  const save = async () => {
    // No-op guard — nothing changed → close, no call, no audit row.
    if (content === (seed ?? '')) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    setError(false)
    // try/finally so a THROWING action (vs a returned {error}) can never
    // strand the sheet in its saving state (Greptile P1, #615).
    let result: Awaited<ReturnType<typeof updateKaruteDetailSummary>>
    try {
      result = await updateKaruteDetailSummary(karuteRecordId, { content })
    } catch {
      setError(true)
      return
    } finally {
      setSaving(false)
    }
    if ('error' in result) {
      setError(true)
      return
    }
    onSaved?.(content)
    router.refresh()
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] gap-3 overflow-y-auto p-5"
        // With no chip row in this sheet, the dialog focus trap's default pick
        // (first tabbable) is the TEXTAREA — whose onFocus would fold the
        // history block the instant an edited summary opens. Anchor initial
        // focus on the history block instead; the design intent is history
        // VISIBLE above the editor until the staff starts typing. A first
        // edit has no block — the trap falls through to the textarea, which
        // is the desired keyboard-on-open behavior there (autoFocus below).
        initialFocus={edited ? historyBlockRef : undefined}
        // Lift by the keyboard, and cap height to the visual viewport's own
        // height (pan-safe — see the keyboard-state comment above).
        // overflow-y-auto absorbs the difference — content scrolls, nothing
        // is crushed (textarea keeps its min-h floor).
        style={
          keyboard
            ? { bottom: keyboard.inset, maxHeight: `min(85vh, ${keyboard.visibleHeight}px)` }
            : undefined
        }
      >
        <SheetHeader className="p-0">
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>

        {edited && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">{tHist('title')}</span>
            {folded ? (
              // Collapsed bar: latest row's text ONLY — no name, no timestamp
              // (Liam ruling, EntryEditSheet). The two unfold paths are
              // platform-exclusive: Android's tap blurs the textarea natively
              // (onBlur unfolds), iOS buttons never steal focus so onClick
              // does the work. The rAF re-anchors keyboard/AT focus onto the
              // restored block — activating this button unmounts it.
              <button
                type="button"
                onClick={() => {
                  textareaRef.current?.blur()
                  setIsTyping(false)
                  requestAnimationFrame(() => historyBlockRef.current?.focus())
                }}
                aria-label={tHist('expand')}
                className="flex items-start gap-2 rounded-xl border border-border p-3 text-left"
              >
                <span
                  className={cn(
                    // Short-viewport degrade carried from EntryEditSheet
                    // (its ~358px clamp-budget note) — this sheet's textarea
                    // floor is 32px BIGGER, so the degrade matters more here.
                    'line-clamp-2 [@media(max-height:360px)]:line-clamp-1 flex-1 text-[13px] leading-relaxed',
                    latestTone === 'error' && 'text-red-500',
                    latestTone === 'content' && 'text-foreground',
                    latestTone === 'muted' && 'text-muted-foreground',
                  )}
                >
                  {latestText}
                </span>
                <span aria-hidden className="shrink-0 text-muted-foreground">
                  ▾
                </span>
              </button>
            ) : (
              <div
                ref={historyBlockRef}
                // Focus target for the ▾ unfold (rAF above); the default
                // focus-visible ring stays — keyboard users need to see
                // where focus landed.
                tabIndex={-1}
                className="max-h-32 overflow-y-auto rounded-xl border border-border p-3"
              >
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
                              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground line-through">
                                {row.contentBefore}
                              </p>
                            )}
                            {row.contentAfter !== null && (
                              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                                {row.contentAfter}
                              </p>
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
            )}
          </div>
        )}

        <textarea
          // Only autofocus when there's no history block above it — the
          // native focus-scroll on open would push the block out of view on
          // a short viewport (EntryEditSheet's fix-round rule). A first edit
          // has no block, so keyboard-on-open behavior is unchanged there.
          autoFocus={!edited}
          ref={textareaRef}
          value={content}
          onChange={(evt) => setContent(evt.target.value)}
          onFocus={() => setIsTyping(true)}
          onBlur={() => setIsTyping(false)}
          rows={6}
          maxLength={4000}
          // min-h-32 holds in both states — the sheet scrolls before the
          // textarea ever shrinks (whole-section text runs taller than an
          // entry's, hence the bigger floor than EntryEditSheet's min-h-24).
          className="w-full min-h-32 resize-none rounded-2xl border border-foreground/70 p-3 text-sm leading-relaxed text-foreground focus:outline-none"
        />

        {error && <p className="text-[13px] text-red-500">{t('error')}</p>}

        <div className="flex items-center justify-end pt-1">
          <button
            type="button"
            // Mid-tap fold-release guard (EntryEditSheet's chip-row comment):
            // a save tap while typing must land on a stable layout.
            onMouseDown={(evt) => evt.preventDefault()}
            onClick={save}
            // Mirror the choke's WHOLE validation, both axes: zero-BULLET
            // content (a lone 「・」 would render an empty card and unmount
            // the pencil — blind-round P2) AND the 4000 cap. maxLength only
            // bounds typing — an uncapped ai_summary can SEED past 4000
            // (process-recording writes the model's text unbounded), and an
            // enabled save the server rejects is a dead-end the generic
            // error can't explain (delta round).
            disabled={
              saving || content.length > 4000 || summaryTextToBullets(content).length === 0
            }
            className="rounded-full bg-primary px-8 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {t('save')}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
