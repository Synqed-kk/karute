'use client'

// ─────────────────────────────────────────────────────────────
// PhotoCaptureDialog — capture flow with category + consent
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/karute/photos/PhotoCaptureDialog.tsx
//
// FLOW
//   1. Staff picks a category (required)
//   2. Staff picks a file from camera/photo library (required)
//   3. Staff optionally adds a caption
//   4. Staff confirms consent (required, defaults to checked)
//   5. Submit → onPhotoCaptured(record) with a local blob URL
//
// ANTHONY — production wires Supabase Storage + insert:
//   await supabase.storage.from('karute-photos').upload(...)
//   await supabase.from('karute_photos').insert({...})
// The dialog stays the same; the body of the submit handler
// swaps in the parent's onPhotoCaptured callback.
//
// SCOPE NOTE
//   karuteId is optional. When the dialog is opened from a
//   specific recording session, pass the karute_record_id.
//   When opened from the customer profile (no session in flight),
//   leave it undefined — Anthony decides if customer-scoped
//   photos use a separate column or a nullable karute_id on the
//   shared `karute_photos` table.

import { useRef, useState } from 'react'
import { Camera, Check, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import { PhotoCategoryPicker } from './PhotoCategoryPicker'
import {
  DEFAULT_PHOTO_CATEGORIES,
  findCategoryByKey,
  type PhotoRecord,
} from './types'

interface PhotoCaptureDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Customer this photo belongs to. Required. */
  customerId: string
  /** Optional karute_record_id when capturing during a recording
   *  session. Omit when capturing from the customer profile. */
  karuteId?: string
  /** Current staff's id + name from the session provider. */
  currentStaffId: string
  currentStaffName: string
  /** Fires with the new PhotoRecord so the caller can persist it
   *  into the local store / re-query. */
  onPhotoCaptured: (photo: PhotoRecord) => void
}

export function PhotoCaptureDialog({
  open,
  onOpenChange,
  customerId,
  karuteId,
  currentStaffId,
  currentStaffName,
  onPhotoCaptured,
}: PhotoCaptureDialogProps) {
  const t = useTranslations('karute.photoCapture')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [categoryKey, setCategoryKey] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [consent, setConsent] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const reset = () => {
    setCategoryKey(null)
    setCaption('')
    setConsent(true)
    setFile(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null
    if (!picked) return
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(picked)
    setPreviewUrl(URL.createObjectURL(picked))
  }

  const canSubmit = categoryKey != null && file != null && consent

  const handleSubmit = () => {
    if (!canSubmit) return
    const category = findCategoryByKey(categoryKey!)
    if (!category || !file || !previewUrl) return

    // SPIKE: build the PhotoRecord locally. ANTHONY replaces this
    // block with the supabase.storage.upload() + insert() chain.
    const nowIso = new Date().toISOString()
    const photo: PhotoRecord = {
      id: `local-${Date.now()}`,
      karuteId: karuteId ?? '',
      customerId,
      capturedByStaffId: currentStaffId,
      capturedByStaffName: currentStaffName,
      capturedAt: nowIso,
      capturedAtLabel: formatDateJa(new Date()),
      categoryKey: category.key,
      categoryLabelSnapshot: category.labelJa,
      caption: caption.trim() || undefined,
      storageUrl: previewUrl,
      thumbnailUrl: previewUrl,
      width: 0,
      height: 0,
      takenWithConsent: consent,
    }

    onPhotoCaptured(photo)
    // Don't revoke previewUrl — the receiving list will display it.
    // Revoke happens on next open via reset().
    setCategoryKey(null)
    setCaption('')
    setFile(null)
    setPreviewUrl(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="size-4 text-blue-600 dark:text-blue-300" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Category */}
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-foreground">
              {t('categoryLabel')}
            </label>
            <PhotoCategoryPicker
              mode="single"
              categories={DEFAULT_PHOTO_CATEGORIES}
              value={categoryKey}
              onChange={setCategoryKey}
            />
          </div>

          {/* File picker + preview */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFilePick}
              className="sr-only"
            />
            {previewUrl ? (
              <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-gray-100 ring-1 ring-black/5 dark:bg-white/[0.04] dark:ring-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute inset-x-2 bottom-2 inline-flex h-8 items-center justify-center rounded-md bg-black/60 text-[12px] font-medium text-white backdrop-blur-[2px]"
                >
                  {t('chooseFile')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 text-muted-foreground transition-colors hover:border-blue-400 dark:border-white/15 dark:bg-white/[0.03] dark:hover:border-blue-500/40"
              >
                <Upload className="size-5" />
                <span className="text-[13px] font-medium">
                  {t('chooseFile')}
                </span>
              </button>
            )}
          </div>

          {/* Caption */}
          <div>
            <label
              htmlFor="photo-caption"
              className="mb-1.5 block text-[12px] font-medium text-foreground"
            >
              {t('captionLabel')}
            </label>
            <Input
              id="photo-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={t('captionPlaceholder')}
            />
          </div>

          {/* Consent */}
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="sr-only"
            />
            <span
              className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                consent
                  ? 'border-blue-600 bg-blue-600'
                  : 'border-gray-300 bg-card dark:border-white/25'
              }`}
            >
              {consent && <Check className="size-3 text-white" strokeWidth={3} />}
            </span>
            <span className="text-[12px] leading-relaxed text-foreground/85">
              {t('consentLabel')}
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatDateJa(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
