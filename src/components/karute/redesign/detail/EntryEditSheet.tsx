'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  // Keyboard-fold (W2 one-sheet consolidation, 2026-07-26 mock): drives the
  // history block's folded-bar layout while the textarea has focus. Only
  // read behind `humanTouched` below — an AI entry's autoFocus firing on
  // open must not fold anything, since it has no history block to fold.
  const [isTyping, setIsTyping] = useState(false)
  // Keyboard occlusion of the LAYOUT viewport's bottom edge (7/28 field fix):
  // the shell's WKWebView doesn't resize the layout viewport when the
  // keyboard shows, so a bottom-anchored fixed sheet mounts UNDER it — the
  // grey-pencil path autoFocuses at open (desired, Liam ruling 7/28), which
  // put the whole sheet behind the keyboard. visualViewport is the only
  // geometry that sees this; the inset lifts the sheet by exactly the
  // occluded height. POSITION ONLY — the fold above stays focus-driven
  // (#621's disclosed wedge: geometry-driven folding can re-crush the
  // textarea when the keyboard reopens on an already-focused field).
  const [keyboard, setKeyboard] = useState<{ inset: number; visibleHeight: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const historyBlockRef = useRef<HTMLDivElement>(null)

  const open = entry !== null
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

  // Reseed only when a NEW entry opens — a re-render mid-edit must not clobber it.
  useEffect(() => {
    if (entry) {
      setContent(entry.body)
      setCategory(entry.category)
      setConflict(false)
      setError(false)
      setIsTyping(false)
    }
  }, [entry])

  const entryId = entry?.id ?? null
  const humanTouched = entry?.author === 'HUMAN_EDITED' || entry?.author === 'HUMAN_CREATED'
  // Folded layout only ever applies to a human-touched entry's own block —
  // an AI entry has no history block to fold, so its (autoFocus-driven)
  // isTyping=true is simply never read.
  const folded = humanTouched && isTyping
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

  // Folded-bar text: mirrors the full block's own loading/error/empty
  // branches below so the bar can never show stale rows or the entry's
  // live body as a stand-in (same honesty rule, condensed to one line).
  // rows[0] is the latest edit — the trail view is newest-first.
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] gap-3 overflow-y-auto p-5"
        // Lift by the keyboard, and cap height to the visual viewport's own
        // height — the sheet's bottom edge sits exactly on the visual
        // viewport's bottom, so that IS its full visible budget (pan-safe).
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

        {humanTouched && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">{tHist('title')}</span>
            {folded ? (
              // Collapsed bar: latest row's text ONLY — no name, no
              // timestamp (Liam ruling). The two unfold paths are
              // platform-exclusive, not redundant: on Android a tap's
              // mousedown blurs the textarea natively (onBlur unfolds,
              // this button may unmount before its click), on iOS buttons
              // never steal focus so this onClick does the work.
              // The rAF re-anchors keyboard/AT focus onto the restored
              // block — activating this button unmounts it, which would
              // otherwise drop focus to document.body. Focusing the
              // textarea instead is NOT an option: its onFocus would
              // immediately re-fold.
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
                    // Clamp budget for the 2-line default: SheetContent
                    // p-5 (40px) + gap-3 × 4 gaps between its 5 children
                    // (48px) + SheetHeader title (~28px) + history label
                    // (~16px) + this bar at 2 lines incl. border/padding
                    // (~60px) + folded chip row (~26px) + textarea
                    // min-h-24/96px + save row (~44px) ≈ 358px of required
                    // content height. Degrade to line-clamp-1 (saves one
                    // ~21px line) once the post-keyboard viewport drops to
                    // 360px or under — matches the packet's own ~360
                    // budget figure, ~2px of slack above the 358px need.
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
            )}
          </div>
        )}

        <div className="relative">
          <div
            className={cn(
              'flex gap-1.5',
              // Categories collapse to one horizontal scroll row while
              // typing; wrap is restored the instant the textarea blurs.
              folded ? 'flex-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'flex-wrap',
            )}
          >
            {CATEGORY_ORDER.map((c) => (
              <button
                key={c}
                type="button"
                // While folded, a mousedown here would blur the textarea and
                // release the fold MID-TAP — the synchronous relayout moves
                // this chip before the synthesized click lands, so the first
                // tap dies (classic focused-input two-tap bug). Prevent the
                // focus steal: the keyboard stays up, the layout stays put,
                // and the category still sets on click.
                onMouseDown={(evt) => evt.preventDefault()}
                onClick={() => setCategory(c)}
                className={cn(
                  'rounded-full border px-3 text-[11.5px] font-semibold transition-colors',
                  folded ? 'h-6 shrink-0' : 'h-[26px]',
                  category === c
                    ? 'border-foreground/30 bg-foreground/10 text-foreground'
                    : 'border-border bg-muted text-muted-foreground',
                )}
              >
                {tCat(c)}
              </button>
            ))}
          </div>
          {folded && (
            <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-r from-transparent to-background" />
          )}
        </div>

        <textarea
          // Fix round: only autofocus when there's no history block above it
          // — the native focus-scroll on open can push a variable-height
          // block out of view on a short viewport, defeating the design
          // intent (history visible above the editor for a human-touched
          // entry). A plain AI entry has no block, so the keyboard-on-tap
          // behavior is unchanged there.
          autoFocus={!humanTouched}
          ref={textareaRef}
          value={content}
          onChange={(evt) => setContent(evt.target.value)}
          onFocus={() => setIsTyping(true)}
          onBlur={() => setIsTyping(false)}
          rows={4}
          maxLength={4000}
          // min-h-24 (96px) holds in both states — the sheet scrolls
          // before the textarea ever shrinks.
          className="w-full min-h-24 resize-none rounded-2xl border border-foreground/70 p-3 text-sm leading-relaxed text-foreground focus:outline-none"
        />

        {conflict && (
          <div className="flex items-center justify-between rounded-xl bg-amber-500/10 p-3 text-[13px] text-amber-700 dark:text-amber-400">
            <span>{t('conflict')}</span>
            <button
              type="button"
              // Same mid-tap fold-release guard as the chips/save button.
              onMouseDown={(evt) => evt.preventDefault()}
              onClick={reload}
              className="font-semibold underline"
            >
              {t('reload')}
            </button>
          </div>
        )}
        {error && <p className="text-[13px] text-red-500">{t('error')}</p>}

        <div className="flex items-center justify-end pt-1">
          <button
            type="button"
            // Guard against the mid-tap fold release (see the chip-row
            // comment): a save tap while typing must land on a stable
            // layout — the sheet closes on save anyway, so keeping the
            // textarea focused through the tap changes nothing else.
            onMouseDown={(evt) => evt.preventDefault()}
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
