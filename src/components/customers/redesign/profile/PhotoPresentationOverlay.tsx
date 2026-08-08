'use client'

// PhotoPresentationOverlay — fullscreen "hand the device to the customer"
// view for the Photos tab. Restored from the pre-redesign spike lift
// (commit ecce3cdd, spike-lifted/photos/PhotoGallerySheet.tsx), which is
// where this privacy contract originated.
//
// PRIVACY CONTRACT: this overlay is the ONLY karute surface safe to hand
// to a customer. It renders exclusively from the `photos` prop already
// passed down to PhotosTabContent (signedUrl / category / caption) — no
// karute notes, AI content, coaching data, or any other app chrome may
// ever render inside it. Don't thread any other prop into this
// component; open the karute detail in staff mode for anything else.
// Captions are staff-internal and must never surface here — not even as
// img alt: an expired signed URL renders alt text on-screen, and
// screen readers speak it. The compare mode added below (selection,
// side-by-side, opacity overlay, 2×2 grid) reads only signedUrl/category
// off the same photos, same rule.
//
// The shell is the app's Base UI Dialog primitive (modal): background
// content goes inert (no VoiceOver/Tab reach into the covered staff UI),
// focus is trapped, scroll is locked, Escape closes. The covered surface
// deliberately includes the recording indicator — the customer must not
// see it; staff regains it on close.
//
// HISTORY GUARD: the overlay pushes one history entry so browser Back and
// the native shell's edge-swipe-back gesture (AppDelegate
// allowsBackForwardNavigationGestures, #647) can't dismiss the overlay in
// front of a customer's thumb. Back/edge-swipe surfaces as popstate — while
// open we just re-push the guard entry and stay open; only a real close
// (hold-complete / Escape / keyboard) unmounts, and cleanup consumes the
// entry with history.back() so the NEXT Back doesn't replay a stale state.
//
// CLOSE CONTRACT: the ✕ is press-and-hold (HOLD_MS), not a tap — a
// customer's idle thumb resting near the corner must not dismiss the
// overlay back into staff UI. Escape and keyboard Enter/Space stay
// instant (no keyboard on a handed-over phone; Escape is the Base UI
// Dialog default via onOpenChange below).

import { useEffect, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { ChevronLeft, ChevronRight, Columns2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { useLongPress } from '@/hooks/use-long-press'
import {
  KNOWN_CATEGORIES,
  toneFor,
  type CustomerPhoto,
} from './PhotosTabContent'

type DisplayablePhoto = CustomerPhoto & { signedUrl: string }
type Translate = ReturnType<typeof useTranslations<'customers.photos'>>
type Stage = 'grid' | 'select' | 'compare'
type CompareSubview = 'side' | 'overlay'
type FullscreenState = { source: 'grid' | 'compare'; index: number }

// 600ms (Liam field-test ruling 8/8): 1200ms felt broken on-device, and the
// button's own ring is hidden under the pressing finger — the big centered
// ring below is the visible progress. Still 2× a deliberate tap, so an idle
// customer thumb won't trip it.
const HOLD_MS = 600
const RING_R = 15
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R

function labelFor(t: Translate, category: string) {
  return KNOWN_CATEGORIES.includes(category) ? t(category) : category
}

interface PhotoPresentationOverlayProps {
  photos: CustomerPhoto[]
  onClose: () => void
}

export function PhotoPresentationOverlay({
  photos,
  onClose,
}: PhotoPresentationOverlayProps) {
  const t = useTranslations('customers.photos')
  const [filterKey, setFilterKey] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('grid')
  const [selected, setSelected] = useState<string[]>([])
  const [compareSubview, setCompareSubview] = useState<CompareSubview>('side')
  const [opacity, setOpacity] = useState(0.5)
  const [fullscreen, setFullscreen] = useState<FullscreenState | null>(null)

  useEffect(() => {
    window.history.pushState({ karutePhotoPresentation: true }, '')
    const onPop = () => {
      // Back/edge-swipe must never dismiss the overlay in front of a
      // customer — re-push the guard entry immediately so the NEXT Back
      // also lands here instead of navigating the app underneath.
      // try/catch: Safari rate-limits pushState (~100/30s); a swipe-mashing
      // customer must degrade to "one unguarded back" (listener stays for
      // the next pop), never an uncaught throw inside a popstate handler.
      try {
        window.history.pushState({ karutePhotoPresentation: true }, '')
      } catch {
        /* rate-limited — next pop retries */
      }
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Back never closes anymore, so unmount only ever happens via a real
      // close (hold-complete / Escape / keyboard) — cleanup always consumes
      // our pushed entry, so the NEXT Back doesn't replay a stale state.
      window.history.back()
    }
  }, [])

  const shown = photos.filter((p): p is DisplayablePhoto => Boolean(p.signedUrl))
  const categoriesInUse = KNOWN_CATEGORIES.filter((key) =>
    shown.some((p) => p.category === key),
  )
  // Derived, not trusted state: if the filtered category vanished from the
  // photos prop, fall back to "all" — a stale filterKey must never strand
  // the customer on a fake-empty screen with the chips row hidden.
  const activeFilter =
    filterKey && categoriesInUse.includes(filterKey) ? filterKey : null
  const visible = shown.filter((p) => activeFilter == null || p.category === activeFilter)

  // Selection is filter-independent (the chips are hidden once selecting) —
  // pick from everything displayable, not just the currently filtered set.
  const gridSource = stage === 'select' ? shown : visible

  const selectedPhotos = selected
    .map((id) => shown.find((p) => p.id === id))
    .filter((p): p is DisplayablePhoto => Boolean(p))
  // Same derived-state guard as the filter fallback above: a photo can
  // vanish out from under an in-progress compare (external deletion) —
  // never strand the customer on a broken 2-up/overlay render.
  const effectiveStage: Stage =
    stage === 'compare' && selectedPhotos.length < 2 ? 'select' : stage

  const fullscreenList = fullscreen?.source === 'compare' ? selectedPhotos : visible
  const safeFullscreen = fullscreen && fullscreenList[fullscreen.index] ? fullscreen : null

  function toggleSelect(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 4) return prev // 5th tap ignored
      return [...prev, id]
    })
  }

  function exitCompare() {
    setStage('grid')
    setSelected([])
  }

  function moveFullscreen(delta: number) {
    setFullscreen((f) => {
      if (!f) return f
      const list = f.source === 'compare' ? selectedPhotos : visible
      if (list.length === 0) return f
      return { ...f, index: (f.index + delta + list.length) % list.length }
    })
  }

  const compareCount = selectedPhotos.length
  const effectiveCompareSubview: CompareSubview | 'grid' =
    compareCount === 2 ? compareSubview : 'grid'

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose() }} modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          aria-label={t('presentButton')}
          className="fixed inset-0 z-[120] flex flex-col bg-background outline-none"
        >
          <div className="border-b border-border pt-[env(safe-area-inset-top)]">
            <div className="flex items-center justify-between px-4 py-3 md:px-6">
              <div>
                {effectiveStage === 'grid' && !safeFullscreen && shown.length >= 2 && (
                  <button
                    type="button"
                    onClick={() => setStage('select')}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary/8 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                  >
                    <Columns2 size={14} />
                    <span>{t('presentCompareButton')}</span>
                  </button>
                )}
                {effectiveStage === 'compare' && !safeFullscreen && (
                  <button
                    type="button"
                    onClick={exitCompare}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {t('presentBack')}
                  </button>
                )}
              </div>
              <HoldToCloseButton onClose={onClose} label={t('presentCloseHold')} />
            </div>
          </div>

          <div className="ios-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
            {safeFullscreen ? (
              <FullscreenViewer
                list={fullscreenList}
                index={safeFullscreen.index}
                onMove={moveFullscreen}
                onExit={() => setFullscreen(null)}
                exitLabel={t('presentBackToGrid')}
                prevLabel={t('presentPrevPhoto')}
                nextLabel={t('presentNextPhoto')}
              />
            ) : effectiveStage === 'compare' ? (
              <CompareStage
                photos={selectedPhotos}
                subview={effectiveCompareSubview}
                onEnterOverlay={() => setCompareSubview('overlay')}
                onEnterSide={() => setCompareSubview('side')}
                onOpenPane={(index) => setFullscreen({ source: 'compare', index })}
                opacity={opacity}
                onOpacityChange={setOpacity}
                t={t}
              />
            ) : (
              <>
                {effectiveStage === 'grid' && categoriesInUse.length > 1 && (
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    <FilterChip
                      active={activeFilter == null}
                      onClick={() => setFilterKey(null)}
                      label={t('presentFilterAll')}
                    />
                    {categoriesInUse.map((key) => (
                      <FilterChip
                        key={key}
                        active={activeFilter === key}
                        onClick={() => setFilterKey(key)}
                        label={t(key)}
                      />
                    ))}
                  </div>
                )}
                {effectiveStage === 'select' && (
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-sm text-foreground">{t('presentSelectHint')}</p>
                    <button
                      type="button"
                      onClick={exitCompare}
                      className="shrink-0 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t('presentSelectCancel')}
                    </button>
                  </div>
                )}
                {gridSource.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    {t('emptyTitle')}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {gridSource.map((photo, i) => {
                      const label = labelFor(t, photo.category)
                      const tone = toneFor(photo.category)
                      const selectedAt =
                        effectiveStage === 'select' ? selected.indexOf(photo.id) : -1
                      return (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() =>
                            effectiveStage === 'select'
                              ? toggleSelect(photo.id)
                              : setFullscreen({ source: 'grid', index: i })
                          }
                          // Ordinal keeps same-category photos distinguishable
                          // to a screen reader.
                          aria-label={`${label} ${i + 1}`}
                          className={`relative aspect-square overflow-hidden rounded-xl border bg-muted transition-colors ${
                            selectedAt >= 0
                              ? 'border-primary ring-2 ring-primary/40'
                              : 'border-border'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.signedUrl}
                            alt={label}
                            className="h-full w-full object-cover"
                          />
                          <span
                            className={`absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tone.bg} ${tone.text}`}
                          >
                            {label}
                          </span>
                          {selectedAt >= 0 && (
                            <span className="absolute right-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                              {selectedAt + 1}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {effectiveStage === 'select' && !safeFullscreen && (
            <div className="border-t border-border px-4 py-3 md:px-6">
              <button
                type="button"
                onClick={() => selected.length >= 2 && setStage('compare')}
                disabled={selected.length < 2}
                className="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40"
              >
                {t('presentCompareCta', { n: selected.length })}
              </button>
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 items-center rounded-full px-3 text-[12px] font-medium transition-colors ${
        active
          ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
          : 'bg-muted text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

// Press-and-hold close: a customer's idle thumb resting near the corner
// must not dismiss the overlay. Timing/pointer bookkeeping reuses the
// shared useLongPress hook (DiscreetRecordingIndicator's hold-to-reveal) —
// its internal setTimeout(thresholdMs) is the source of truth for the
// actual close; the SVG ring below is a CSS-transition-driven visual only,
// it never gates it. The hook's onShortTap only fires on pointerup (leave/
// cancel stay silent, right for a discreet reveal); this control wants the
// same reset+shake for all three early-release paths, so that's handled
// here instead of via onShortTap. Keyboard Enter/Space is the
// accessibility escape hatch (a customer holding the phone has no
// keyboard) and closes immediately, matching Escape's instant close via
// the Dialog's own onOpenChange.
// The button keeps its own small ring (visible for mouse users), but on
// touch the pressing finger covers it — so a big viewport-centered twin
// ring renders while holding. It's always mounted (opacity-toggled) so the
// stroke transition animates from empty on every press; pointer-events-none
// keeps it from stealing the pointer mid-hold (which would fire
// pointerleave and cancel the hold it's reporting on).
function HoldToCloseButton({ onClose, label }: { onClose: () => void; label: string }) {
  const [holding, setHolding] = useState(false)
  const [shaking, setShaking] = useState(false)
  const press = useLongPress({ thresholdMs: HOLD_MS, onLongPress: onClose })

  function release() {
    setHolding(false)
    setShaking(true)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="hold-progress-ring"
        className={`pointer-events-none fixed inset-0 z-10 flex items-center justify-center transition-opacity ${
          holding ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <svg viewBox="0 0 36 36" className="size-24 -rotate-90">
          <circle
            cx="18"
            cy="18"
            r={RING_R}
            fill="none"
            strokeWidth="2.5"
            className="stroke-current text-border"
          />
          <circle
            cx="18"
            cy="18"
            r={RING_R}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            className="stroke-current text-primary"
            style={{
              strokeDashoffset: holding ? 0 : RING_CIRCUMFERENCE,
              transition: holding ? `stroke-dashoffset ${HOLD_MS}ms linear` : 'none',
            }}
          />
        </svg>
      </div>
      <button
        type="button"
        onPointerDown={(e) => {
          setShaking(false)
          setHolding(true)
          press.onPointerDown(e)
        }}
        onPointerMove={press.onPointerMove}
        onPointerUp={() => {
          release()
          press.onPointerUp()
        }}
        onPointerLeave={() => {
          release()
          press.onPointerLeave()
        }}
        onPointerCancel={() => {
          release()
          press.onPointerCancel()
        }}
        onKeyDown={handleKeyDown}
        onAnimationEnd={() => setShaking(false)}
        aria-label={label}
        className={`relative inline-flex size-9 select-none items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-muted [-webkit-touch-callout:none] ${
          shaking ? 'motion-safe:animate-[hold-cancel-shake_0.3s_ease-in-out]' : ''
        }`}
      >
        <svg viewBox="0 0 36 36" aria-hidden="true" className="pointer-events-none absolute inset-0 -rotate-90">
          <circle
            cx="18"
            cy="18"
            r={RING_R}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            className="stroke-current text-primary"
            style={{
              strokeDashoffset: holding ? 0 : RING_CIRCUMFERENCE,
              transition: holding ? `stroke-dashoffset ${HOLD_MS}ms linear` : 'none',
            }}
          />
        </svg>
        <X size={18} />
      </button>
    </>
  )
}

// Single/multi-photo fullscreen browsing — used both for the plain grid
// (list = the currently filtered photos) and for a 3–4 photo compare grid
// pane tap (list = just the selected set). Tap the photo to exit; chevrons
// + a basic swipe cycle through `list`; dots are decorative (chevrons/swipe
// are the accessible nav).
function FullscreenViewer({
  list,
  index,
  onMove,
  onExit,
  exitLabel,
  prevLabel,
  nextLabel,
}: {
  list: DisplayablePhoto[]
  index: number
  onMove: (delta: number) => void
  onExit: () => void
  exitLabel: string
  prevLabel: string
  nextLabel: string
}) {
  const photo = list[index]
  const touchStartXRef = useRef<number | null>(null)
  if (!photo) return null
  return (
    <div
      className="relative"
      onTouchStart={(e) => {
        touchStartXRef.current = e.touches[0]?.clientX ?? null
      }}
      onTouchEnd={(e) => {
        const startX = touchStartXRef.current
        touchStartXRef.current = null
        const endX = e.changedTouches[0]?.clientX
        if (startX == null || endX == null) return
        const delta = endX - startX
        if (delta > 40) onMove(-1)
        else if (delta < -40) onMove(1)
      }}
    >
      <button type="button" onClick={onExit} aria-label={exitLabel} className="block w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.signedUrl}
          alt=""
          className="mx-auto h-auto max-h-[75vh] w-full max-w-2xl rounded-xl object-contain"
        />
      </button>
      {list.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => onMove(-1)}
            aria-label={prevLabel}
            className="absolute left-1 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground/70 transition-colors hover:bg-muted"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            aria-label={nextLabel}
            className="absolute right-1 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground/70 transition-colors hover:bg-muted"
          >
            <ChevronRight size={22} />
          </button>
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5"
          >
            {list.map((p, i) => (
              <span
                key={p.id}
                className={`size-1.5 rounded-full ${i === index ? 'bg-muted-foreground' : 'bg-muted-foreground/40'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// COMPARE stage content: 2 photos → side-by-side (tap → opacity overlay,
// tap again → back), 3–4 photos → 2×2 grid (tap a pane → fullscreen browsing
// over just the selected set, handled by the caller via FullscreenViewer).
function CompareStage({
  photos,
  subview,
  onEnterOverlay,
  onEnterSide,
  onOpenPane,
  opacity,
  onOpacityChange,
  t,
}: {
  photos: DisplayablePhoto[]
  subview: CompareSubview | 'grid'
  onEnterOverlay: () => void
  onEnterSide: () => void
  onOpenPane: (index: number) => void
  opacity: number
  onOpacityChange: (next: number) => void
  t: Translate
}) {
  if (subview === 'grid') {
    return (
      <div className="grid grid-cols-2 gap-3">
        {photos.map((photo, i) => {
          const label = labelFor(t, photo.category)
          const tone = toneFor(photo.category)
          return (
            <button
              key={photo.id}
              type="button"
              onClick={() => onOpenPane(i)}
              aria-label={`${label} ${i + 1}`}
              className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.signedUrl} alt={label} className="h-full w-full object-cover" />
              <span
                className={`absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tone.bg} ${tone.text}`}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  const [a, b] = photos
  if (!a || !b) return null

  if (subview === 'overlay') {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={onEnterSide}
          aria-label={t('compareSideBySide')}
          // 3:4 like the side-by-side panes it toggles with — a square canvas
          // crops the top of portrait salon shots (hair!) and jumps geometry
          // on every toggle.
          className="relative mx-auto block aspect-[3/4] w-full max-w-md overflow-hidden rounded-xl bg-muted"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.signedUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={b.signedUrl}
            alt=""
            style={{ opacity }}
            className="absolute inset-0 h-full w-full object-cover transition-opacity"
          />
        </button>
        <div className="mx-auto flex max-w-md items-center gap-2 px-1">
          <span className="w-14 shrink-0 text-[11px] text-muted-foreground">
            {labelFor(t, a.category)}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={opacity}
            onChange={(e) => onOpacityChange(Number(e.target.value))}
            aria-label={t('compareOpacity')}
            className="h-1.5 flex-1 accent-primary"
          />
          <span className="w-14 shrink-0 text-right text-[11px] text-muted-foreground">
            {labelFor(t, b.category)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onEnterOverlay}
      aria-label={t('compareOverlay')}
      className="grid w-full grid-cols-2 gap-3"
    >
      <ComparePane photo={a} t={t} />
      <ComparePane photo={b} t={t} />
    </button>
  )
}

function ComparePane({ photo, t }: { photo: DisplayablePhoto; t: Translate }) {
  const label = labelFor(t, photo.category)
  const tone = toneFor(photo.category)
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.signedUrl} alt={label} className="absolute inset-0 h-full w-full object-cover" />
      <span
        className={`absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tone.bg} ${tone.text}`}
      >
        {label}
      </span>
    </div>
  )
}
