'use client'

import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { Eye } from 'lucide-react'
import { toast } from 'sonner'

import { sessionPhotoStore } from '@/lib/karute/session-photos'
import { listCustomerPhotos } from '@/actions/customers'
import { PhotoPresentationOverlay } from '@/components/customers/redesign/profile/PhotoPresentationOverlay'
import type { CustomerPhoto } from '@/components/customers/redesign/profile/PhotosTabContent'

// KNOWN_CATEGORIES is NOT exported on main — mirrored locally; keep in sync
// with src/components/customers/redesign/profile/PhotosTabContent.tsx.
const CATEGORIES = ['before', 'after', 'reference', 'progress'] as const

export function SessionPhotoCard({
  customerId,
  takenWithConsent,
}: {
  customerId: string
  /** D2: recording consent status AT CAPTURE TIME (RecordPageView passes
   *  Boolean(consentDate)) — forwarded to addPhoto so it's frozen per-photo,
   *  not re-read on upload/retry. */
  takenWithConsent: boolean
}) {
  const t = useTranslations('recording.sessionPhotos')
  const tCat = useTranslations('customers.photos')
  const inputRef = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState<string>(CATEGORIES[0])
  const [presenting, setPresenting] = useState(false)
  const [presentPending, setPresentPending] = useState(false)
  const [presentPhotos, setPresentPhotos] = useState<CustomerPhoto[]>([])

  const subscribe = useCallback((fn: () => void) => sessionPhotoStore.subscribe(fn), [])
  const getSnapshot = useCallback(() => sessionPhotoStore.photos, [])
  const getServerSnapshot = useCallback(() => sessionPhotoStore.photos, [])
  const allPhotos = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  // Defense-in-depth (blind-round P3): the store can only ever hold one
  // session's photos today (cleared at idle before any re-bind), but this
  // card must never render another customer's strip even if that invariant
  // weakens. Render-body filter — getSnapshot must stay reference-stable.
  const photos = allPhotos.filter((p) => p.customerId === customerId)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) sessionPhotoStore.addPhoto(file, category, customerId, { takenWithConsent })
    e.target.value = ''
  }

  // お客様に見せる (PR 9b §③): pulls the CUSTOMER AGGREGATE — past photos
  // included — never this card's in-session-scoped `photos` above. Structure
  // rule (Liam 8/9): compare/presentation surfaces are deliberately
  // cross-session. PhotoPresentationOverlay's own full-screen modal shell
  // already covers DiscreetRecordingIndicator (z-[120] opaque popup over its
  // z-[100] dot) — no extra interlock plumbing needed at this mount.
  const presentingRef = useRef(false)
  async function handlePresent() {
    // Ref guard (synchronous, unlike the presentPending state re-render): a
    // double-tap before the disabled prop commits must not fire two fetches.
    if (presentingRef.current) return
    presentingRef.current = true
    setPresentPending(true)
    try {
      const result = await listCustomerPhotos(customerId)
      setPresentPhotos(
        (result.photos ?? []).map((p) => ({
          id: p.id,
          signedUrl: p.signed_url,
          category: p.category,
          caption: p.caption,
        })),
      )
      setPresenting(true)
    } catch {
      toast.error(t('presentError'))
    } finally {
      presentingRef.current = false
      setPresentPending(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{t('title')}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {t('count', { n: photos.length })}
        </span>
      </header>

      <div className="mb-3 flex items-center gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label={tCat('categoryLabel')}
          className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
        >
          {CATEGORIES.map((key) => (
            <option key={key} value={key}>{tCat(key)}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-8 items-center rounded-lg bg-sky-500/15 px-3 text-xs font-medium text-sky-600 transition-colors hover:bg-sky-500/25 dark:text-sky-300"
        >
          {t('take')}
        </button>
        {/* capture="environment" opens the rear camera directly — a plain
            file input falls back to the pick-only gallery on phones
            (field-verified 2026-08-02: proven broken without this
            attribute). */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
          className="hidden"
        />
        {/* お客様に見せる: reuses customers.photos.presentButton verbatim —
            same string, same action, as PhotosTabContent's button. */}
        <button
          type="button"
          onClick={handlePresent}
          disabled={presentPending}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 disabled:opacity-60"
        >
          <Eye size={14} />
          <span>{tCat('presentButton')}</span>
        </button>
      </div>

      {photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => p.status === 'error' && sessionPhotoStore.retry(p.id)}
              aria-label={
                p.status === 'error'
                  ? t('retry')
                  : p.status === 'uploading'
                    ? tCat('uploading')
                    : tCat(p.category)
              }
              className={`relative aspect-square w-16 shrink-0 overflow-hidden rounded-xl border ${
                p.status === 'error' ? 'border-destructive' : 'border-border'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.objectUrl} alt="" className="h-full w-full object-cover" />
              {p.status !== 'error' && (
                <span
                  className={`absolute right-1 top-1 size-2 rounded-full ring-1 ring-white/90 ${
                    p.status === 'uploading' ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                />
              )}
            </button>
          ))}
        </div>
      )}

      {photos.some((p) => p.status === 'error') && (
        <p className="mt-2 text-xs text-destructive">{t('uploadError')}</p>
      )}

      {presenting && (
        <PhotoPresentationOverlay
          photos={presentPhotos}
          onClose={() => setPresenting(false)}
        />
      )}
    </section>
  )
}
