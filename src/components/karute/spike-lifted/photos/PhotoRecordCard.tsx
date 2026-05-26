'use client'

// ─────────────────────────────────────────────────────────────
// PhotoRecordCard — entry point for the photos sub-system
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE (visual: ~95% verbatim; hooks + button targets adapted)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute/photos/PhotoRecordCard.tsx
//
// STEP 2 LIFT (this commit): Coming-Soon stub replaced with the
// real PhotoCaptureDialog + PhotoGallerySheet (+ PhotoCompareView
// inside). Lifted in PR alongside this file.
//
// Wires:
//   "Add photo" button     → PhotoCaptureDialog
//   "Show customer" / "See all" / thumbnail tap → PhotoGallerySheet
//
// ANTHONY: integration spec — see
//   spike's docs/SUPABASE_SCHEMA_PROPOSAL.md  (photo_records table)
//   spike's docs/AI_INTEGRATION_SPEC.md       (photos NOT in AI surfaces)
// Production swap is one file: replace usePhotoStore body with the
// Supabase query template at the top of the spike's
// src/lib/data/karute/photos.ts.

import { useState } from 'react'
import { Camera, Eye, Images, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { useSession } from '@/providers/session-provider'

import { PhotoCaptureDialog } from './PhotoCaptureDialog'
import { PhotoGallerySheet } from './PhotoGallerySheet'
import { PhotoThumbnail } from './PhotoThumbnail'
import { usePhotoStore } from './usePhotoStore'

interface Props {
  /** Customer this karute belongs to. Threaded through so the hook
   *  call gets the right scope once it's wired to Supabase. Display
   *  uses the customer's name in the gallery sheet title. */
  customerName: string
  /** Customer id — required so newly-captured photos record the
   *  right anchor. */
  customerId?: string
  /** Optional karute_record_id. Pass when this card is rendered
   *  inside a specific recording session's karute detail. Omit
   *  when on the customer profile (photos get anchored to the
   *  customer, not a particular session). */
  karuteId?: string
}

export function PhotoRecordCard({
  customerName,
  customerId = '',
  karuteId,
}: Props) {
  const t = useTranslations('karute.photoSection')
  const session = useSession()
  const { photos, addPhoto } = usePhotoStore()

  const recent = photos.slice(0, 4)
  const hasPhotos = recent.length > 0

  const [captureOpen, setCaptureOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)

  const currentStaffId = session.activeStaff?.id ?? session.userId
  const currentStaffName = session.activeStaff?.name ?? ''

  return (
    <>
      <section className="bg-card border-b border-black/5 p-4 dark:border-white/5 md:rounded-xl md:border-0 md:p-5 md:ring-1 md:ring-black/5 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:dark:ring-white/5 md:dark:shadow-none">
        {/* Header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Images className="size-4 shrink-0 text-blue-600 dark:text-blue-300" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                {t('title')}
              </h3>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {t('subtitle')}
              </p>
            </div>
          </div>
          {hasPhotos && (
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium text-blue-700 transition-colors hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/10"
            >
              <Eye className="size-3.5" />
              {t('showCustomer')}
            </button>
          )}
        </div>

        {/* Thumbnail strip or empty state */}
        {hasPhotos ? (
          <div className="grid grid-cols-4 gap-2">
            {recent.map((photo) => (
              <PhotoThumbnail
                key={photo.id}
                photo={photo}
                onClick={() => setGalleryOpen(true)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center dark:border-white/10 dark:bg-white/[0.03]">
            <Camera className="mx-auto mb-1.5 size-5 text-gray-400 dark:text-gray-500" />
            <div className="text-[13px] font-medium text-foreground">
              {t('emptyTitle')}
            </div>
            <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">
              {t('emptyBody')}
            </p>
          </div>
        )}

        {/* Actions row */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setCaptureOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-[13px] font-medium text-background transition-colors hover:opacity-90"
          >
            <Plus className="size-3.5" />
            {t('add')}
          </button>
          {hasPhotos && (
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
              className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('seeAll')}（{photos.length}）
            </button>
          )}
        </div>
      </section>

      <PhotoCaptureDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        customerId={customerId}
        karuteId={karuteId}
        currentStaffId={currentStaffId}
        currentStaffName={currentStaffName}
        onPhotoCaptured={addPhoto}
      />

      <PhotoGallerySheet
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        photos={photos}
        customerName={customerName}
      />
    </>
  )
}
