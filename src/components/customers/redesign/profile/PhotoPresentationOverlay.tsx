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
// It covers the full viewport (fixed inset-0, opaque background, above
// every other z-index in the app) so nothing behind it — cards, nav,
// recording indicators — is visible while a customer is looking at the
// screen. The only staff-facing control is the exit (X) button.

import { useState } from 'react'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  KNOWN_CATEGORIES,
  toneFor,
  type CustomerPhoto,
} from './PhotosTabContent'

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

  const shown = photos.filter((p) => p.signedUrl)
  const visible = shown.filter((p) => filterKey == null || p.category === filterKey)
  const categoriesInUse = KNOWN_CATEGORIES.filter((key) =>
    shown.some((p) => p.category === key),
  )
  const enlarged = enlargedId ? visible.find((p) => p.id === enlargedId) : undefined

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-background">
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
              src={enlarged.signedUrl!}
              alt=""
              className="mx-auto h-auto max-h-[75vh] w-full max-w-2xl rounded-xl object-contain"
            />
          </button>
        ) : (
          <>
            {categoriesInUse.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                <FilterChip
                  active={filterKey == null}
                  onClick={() => setFilterKey(null)}
                  label={t('presentFilterAll')}
                />
                {categoriesInUse.map((key) => (
                  <FilterChip
                    key={key}
                    active={filterKey === key}
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
                {visible.map((photo) => {
                  const label = KNOWN_CATEGORIES.includes(photo.category)
                    ? t(photo.category)
                    : photo.category
                  const tone = toneFor(photo.category)
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => setEnlargedId(photo.id)}
                      aria-label={label}
                      className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.signedUrl!}
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
    </div>
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
