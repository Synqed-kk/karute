'use client'

// ─────────────────────────────────────────────────────────────
// PhotoGallerySheet — customer-safe photo gallery
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/karute/photos/PhotoGallerySheet.tsx
//
// PRIVACY CONTRACT: this sheet is the ONLY karute surface safe
// to hand to a customer. It reads one data source (photo records)
// and renders no AI suggestions, coaching content, private
// notes, or other karute fields. Don't add any of those here —
// open the karute detail in staff mode instead.
//
// ANTHONY: the query backing this sheet MUST be strictly
// `karute_photos` for the given karute / customer. No joins to
// coaching_* or karute_entries tables.
//
// THREE INTERNAL MODES
//
//   grid     — filter chips + thumbnail grid (default)
//   detail   — tap a photo, full-image + caption + meta
//   compare  — toggle compare, pick two photos, side-by-side
//              + overlay tabs via PhotoCompareView

import { useMemo, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

import { PhotoCategoryPicker } from './PhotoCategoryPicker'
import { PhotoCompareView } from './PhotoCompareView'
import { PhotoThumbnail } from './PhotoThumbnail'
import {
  DEFAULT_PHOTO_CATEGORIES,
  findCategoryByKey,
  type PhotoRecord,
} from './types'

interface PhotoGallerySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  photos: PhotoRecord[]
  customerName: string
}

type SheetMode =
  | { kind: 'grid' }
  | { kind: 'detail'; photoId: string }
  | { kind: 'compare'; pickedIds: string[] }

export function PhotoGallerySheet({
  open,
  onOpenChange,
  photos,
  customerName,
}: PhotoGallerySheetProps) {
  const t = useTranslations('karute.photoGallery')

  const [filterKey, setFilterKey] = useState<string | null>(null)
  const [mode, setMode] = useState<SheetMode>({ kind: 'grid' })

  // Show only categories that actually have photos — keeps the
  // filter row honest on sparse data.
  const categoriesWithPhotos = useMemo(() => {
    const keysInUse = new Set(photos.map((p) => p.categoryKey))
    return DEFAULT_PHOTO_CATEGORIES.filter((c) => keysInUse.has(c.key))
  }, [photos])

  const visible = useMemo(
    () =>
      filterKey == null
        ? photos
        : photos.filter((p) => p.categoryKey === filterKey),
    [photos, filterKey],
  )

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setMode({ kind: 'grid' })
      setFilterKey(null)
    }
    onOpenChange(next)
  }

  const pickedInCompare = mode.kind === 'compare' ? mode.pickedIds : []

  const handleThumbTap = (photo: PhotoRecord) => {
    if (mode.kind === 'compare') {
      const already = pickedInCompare.includes(photo.id)
      let next: string[]
      if (already) next = pickedInCompare.filter((id) => id !== photo.id)
      else if (pickedInCompare.length < 2) next = [...pickedInCompare, photo.id]
      else next = [pickedInCompare[1]!, photo.id] // rolling: drop oldest, add new
      setMode({ kind: 'compare', pickedIds: next })
      return
    }
    setMode({ kind: 'detail', photoId: photo.id })
  }

  const detailPhoto =
    mode.kind === 'detail'
      ? (photos.find((p) => p.id === mode.photoId) ?? null)
      : null

  const comparePhotos =
    mode.kind === 'compare' && pickedInCompare.length === 2
      ? pickedInCompare
          .map((id) => photos.find((p) => p.id === id))
          .filter((x): x is PhotoRecord => !!x)
      : null

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="flex h-[92vh] flex-col p-0 md:mx-auto md:h-[88vh] md:max-w-3xl md:rounded-t-2xl"
      >
        {/* Header — always visible */}
        <SheetHeader className="flex-row items-center gap-2 space-y-0 border-b border-black/5 px-4 py-3 md:px-5 dark:border-white/5">
          {mode.kind === 'detail' && (
            <button
              type="button"
              onClick={() => setMode({ kind: 'grid' })}
              aria-label={t('back')}
              className="inline-flex size-8 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            >
              <ArrowLeft className="size-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-[15px] font-semibold text-foreground">
              {t('header', { name: customerName })}
            </SheetTitle>
            {mode.kind === 'compare' && (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {t('comparePickHint')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            aria-label={t('close')}
            className="inline-flex size-8 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="size-4" />
          </button>
        </SheetHeader>

        {/* Body */}
        <div className="ios-scroll min-h-0 flex-1 overflow-y-auto">
          {mode.kind === 'grid' && (
            <div className="space-y-4 px-4 py-4 md:px-5">
              {categoriesWithPhotos.length > 1 && (
                <PhotoCategoryPicker
                  mode="filter"
                  categories={categoriesWithPhotos}
                  value={filterKey}
                  onChange={setFilterKey}
                  allLabel={t('filterAll')}
                />
              )}
              <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
                {visible.map((photo) => (
                  <PhotoThumbnail
                    key={photo.id}
                    photo={photo}
                    onClick={() => handleThumbTap(photo)}
                  />
                ))}
              </div>
            </div>
          )}

          {mode.kind === 'detail' && detailPhoto && (
            <DetailView photo={detailPhoto} />
          )}

          {mode.kind === 'compare' && (
            <div className="space-y-4 px-4 py-4 md:px-5">
              {comparePhotos ? (
                <PhotoCompareView a={comparePhotos[0]!} b={comparePhotos[1]!} />
              ) : (
                <div className="rounded-lg bg-blue-50 px-4 py-3 text-[12px] text-blue-900 ring-1 ring-blue-200/60 dark:bg-blue-500/[0.08] dark:text-blue-200 dark:ring-blue-500/20">
                  {t('comparePickHint')}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
                {visible.map((photo) => (
                  <PhotoThumbnail
                    key={photo.id}
                    photo={photo}
                    onClick={() => handleThumbTap(photo)}
                    selected={pickedInCompare.includes(photo.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer — compare toggle (hidden in detail mode) */}
        {mode.kind !== 'detail' && photos.length >= 2 && (
          <div className="flex justify-center border-t border-black/5 px-4 py-3 md:px-5 dark:border-white/5">
            {mode.kind === 'grid' ? (
              <button
                type="button"
                onClick={() => setMode({ kind: 'compare', pickedIds: [] })}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-card px-4 text-[13px] font-medium text-foreground ring-1 ring-black/10 transition-colors hover:ring-black/20 dark:ring-white/15 dark:hover:ring-white/25"
              >
                {t('compareToggle')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMode({ kind: 'grid' })}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-card px-4 text-[13px] font-medium text-foreground ring-1 ring-black/10 transition-colors hover:ring-black/20 dark:ring-white/15 dark:hover:ring-white/25"
              >
                {t('compareExit')}
              </button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function DetailView({ photo }: { photo: PhotoRecord }) {
  const t = useTranslations('karute.photoGallery')
  const category = findCategoryByKey(photo.categoryKey)
  const categoryLabel = category?.labelJa ?? photo.categoryLabelSnapshot

  return (
    <div className="space-y-3 px-4 py-4 md:px-5">
      <div className="relative w-full overflow-hidden rounded-lg bg-gray-100 ring-1 ring-black/5 dark:bg-white/[0.04] dark:ring-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.storageUrl}
          alt={photo.caption ?? categoryLabel}
          className="h-auto max-h-[60vh] w-full bg-black/[0.03] object-contain"
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-5 items-center rounded-full bg-blue-50 px-2 text-[11px] font-medium text-blue-800 ring-1 ring-blue-200/60 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/20">
            {categoryLabel}
          </span>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {photo.capturedAtLabel}
          </span>
        </div>
        <p className="text-[14px] leading-relaxed text-foreground/90">
          {photo.caption ?? (
            <span className="italic text-muted-foreground">
              {t('noCaption')}
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {t('takenBy', { name: photo.capturedByStaffName })}
        </p>
      </div>
    </div>
  )
}
