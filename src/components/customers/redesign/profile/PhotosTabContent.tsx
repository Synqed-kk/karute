'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Columns2, Eye, Image as ImageIcon, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { uploadCustomerPhoto } from '@/actions/customers'
import { shrinkPhotoForUpload } from '@/lib/photo-shrink'
import { PhotoCompareView } from './PhotoCompareView'
import { PhotoPresentationOverlay } from './PhotoPresentationOverlay'

export interface CustomerPhoto {
  id: string
  signedUrl: string | null
  category: string
  caption: string | null
}

interface PhotosTabContentProps {
  customerId: string
  photos: CustomerPhoto[]
}

const CATEGORY_TONE: Record<string, { bg: string; text: string }> = {
  before: { bg: 'bg-sky-500/15', text: 'text-sky-700 dark:text-sky-300' },
  after: { bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300' },
  reference: { bg: 'bg-violet-500/15', text: 'text-violet-700 dark:text-violet-300' },
  progress: { bg: 'bg-cyan-500/15', text: 'text-cyan-700 dark:text-cyan-300' },
}

// Exported so PhotoCompareView / PhotoPresentationOverlay (both restored
// from the pre-#281 spike lift) can label thumbnails with the same tones
// instead of redefining the category → color map.
export const KNOWN_CATEGORIES = ['before', 'after', 'reference', 'progress']

export function toneFor(category: string) {
  return (
    CATEGORY_TONE[category] ?? {
      bg: 'bg-muted',
      text: 'text-muted-foreground',
    }
  )
}

export function PhotosTabContent({ customerId, photos }: PhotosTabContentProps) {
  const t = useTranslations('customers.photos')
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState('before')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [presentationOpen, setPresentationOpen] = useState(false)
  const comparableCount = photos.filter((p) => p.signedUrl).length

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const upload = await shrinkPhotoForUpload(file)
        const fd = new FormData()
        fd.append('file', upload)
        fd.append('category', category)
        const result = await uploadCustomerPhoto(customerId, fd)
        if (result && 'error' in result) throw new Error(result.error)
      }
      // Photos are server-loaded (listCustomerPhotos on the page); refresh
      // re-renders the grid with the new signed URLs.
      router.refresh()
    } catch {
      setError(t('uploadError'))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const uploadControls = (
    <div className="flex items-center gap-2">
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        disabled={uploading}
        aria-label={t('categoryLabel')}
        className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
      >
        {KNOWN_CATEGORIES.map((key) => (
          <option key={key} value={key}>
            {t(key)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-500/15 px-3 text-xs font-medium text-sky-600 transition-colors hover:bg-sky-500/25 disabled:opacity-60 dark:text-sky-300"
      >
        {uploading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Camera size={14} />
        )}
        <span>{uploading ? t('uploading') : t('addPhoto')}</span>
      </button>
    </div>
  )

  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      multiple
      onChange={handleFileSelect}
      className="hidden"
    />
  )

  // Rendered in BOTH branches: if a refresh empties `photos` while the
  // customer is holding the device, the overlay must stay mounted (showing
  // its own empty state) — the empty-state early return silently swapping
  // it for staff UI is exactly the leak the privacy contract forbids.
  const presentation = presentationOpen && (
    <PhotoPresentationOverlay
      photos={photos}
      onClose={() => setPresentationOpen(false)}
    />
  )

  if (photos.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center shadow-sm md:px-8 md:py-16">
        {hiddenInput}
        {presentation}
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ImageIcon size={18} />
        </div>
        <p className="text-sm font-semibold text-foreground">{t('emptyTitle')}</p>
        <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
          {t('emptyBody')}
        </p>
        <div className="mt-4 flex justify-center">{uploadControls}</div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      </section>
    )
  }
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      {hiddenInput}
      <header className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-300">
          <ImageIcon size={14} />
        </div>
        <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          {t('count', { n: photos.length })}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCompareOpen((v) => !v)}
            // Exit must stay tappable even if a refresh drops the photo count
            // below 2 while compare is open — else staff is stuck in compare.
            disabled={!compareOpen && comparableCount < 2}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 disabled:opacity-40"
          >
            <Columns2 size={14} />
            <span>{compareOpen ? t('compareExit') : t('compareButton')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              // Interlock: compare renders captions (staff-internal) — it
              // must never sit in the DOM behind the customer-safe overlay.
              setCompareOpen(false)
              setPresentationOpen(true)
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/70"
          >
            <Eye size={14} />
            <span>{t('presentButton')}</span>
          </button>
          {uploadControls}
        </div>
      </header>
      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
      {compareOpen ? (
        <PhotoCompareView photos={photos} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {photos.map((p) => {
            const tone = toneFor(p.category)
            const label = KNOWN_CATEGORIES.includes(p.category)
              ? t(p.category)
              : p.category
            return (
              <div
                key={p.id}
                className="flex flex-col gap-2 overflow-hidden rounded-xl border border-border bg-background/40"
              >
                <div className="relative aspect-square bg-muted">
                  {p.signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.signedUrl}
                      alt={p.caption ?? label}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                  <span
                    className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${tone.bg} ${tone.text}`}
                  >
                    {label}
                  </span>
                </div>
                {p.caption && (
                  <p className="line-clamp-2 px-2 pb-2 text-[11px] text-muted-foreground">
                    {p.caption}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
      {presentation}
    </section>
  )
}
