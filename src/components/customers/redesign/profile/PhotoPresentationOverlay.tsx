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
// screen readers speak it.
//
// The shell is the app's Base UI Dialog primitive (modal): background
// content goes inert (no VoiceOver/Tab reach into the covered staff UI),
// focus is trapped, scroll is locked, Escape closes. The covered surface
// deliberately includes the recording indicator — the customer must not
// see it; staff regains it on close.
//
// HISTORY GUARD: the overlay pushes one history entry so browser Back and
// the native shell's edge-swipe-back gesture (AppDelegate
// allowsBackForwardNavigationGestures, #647) close the overlay instead of
// navigating the signed-in app underneath a customer's thumb.

import { useEffect, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  KNOWN_CATEGORIES,
  toneFor,
  type CustomerPhoto,
} from './PhotosTabContent'

type DisplayablePhoto = CustomerPhoto & { signedUrl: string }

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
  const [enlargedId, setEnlargedId] = useState<string | null>(null)

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const closedByPopRef = useRef(false)
  useEffect(() => {
    window.history.pushState({ karutePhotoPresentation: true }, '')
    const onPop = () => {
      closedByPopRef.current = true
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // Closed by X/Escape: consume our own entry so the NEXT Back doesn't
      // replay a stale state. Closed by Back itself: already consumed.
      if (!closedByPopRef.current) window.history.back()
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
  const enlarged = enlargedId ? visible.find((p) => p.id === enlargedId) : undefined

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose() }} modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          aria-label={t('presentButton')}
          className="fixed inset-0 z-[120] flex flex-col bg-background outline-none"
        >
          <div className="flex items-center justify-end border-b border-border px-4 py-3 md:px-6">
            <button
              type="button"
              onClick={onClose}
              aria-label={t('presentClose')}
              className="inline-flex size-9 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-muted"
            >
              <X size={18} />
            </button>
          </div>

          <div className="ios-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
            {enlarged ? (
              <button
                type="button"
                onClick={() => setEnlargedId(null)}
                aria-label={t('presentBackToGrid')}
                className="block w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enlarged.signedUrl}
                  alt=""
                  className="mx-auto h-auto max-h-[75vh] w-full max-w-2xl rounded-xl object-contain"
                />
              </button>
            ) : (
              <>
                {categoriesInUse.length > 1 && (
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
                {visible.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    {t('emptyTitle')}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {visible.map((photo, i) => {
                      const label = KNOWN_CATEGORIES.includes(photo.category)
                        ? t(photo.category)
                        : photo.category
                      const tone = toneFor(photo.category)
                      return (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => setEnlargedId(photo.id)}
                          // Ordinal keeps same-category photos distinguishable
                          // to a screen reader.
                          aria-label={`${label} ${i + 1}`}
                          className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted"
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
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </div>
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
