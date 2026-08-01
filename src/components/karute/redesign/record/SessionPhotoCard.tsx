'use client'

import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'

import { sessionPhotoStore } from '@/lib/karute/session-photos'

// KNOWN_CATEGORIES is NOT exported on main — mirrored locally; keep in sync
// with src/components/customers/redesign/profile/PhotosTabContent.tsx.
const CATEGORIES = ['before', 'after', 'reference', 'progress'] as const

export function SessionPhotoCard({ customerId }: { customerId: string }) {
  const t = useTranslations('recording.sessionPhotos')
  const tCat = useTranslations('customers.photos')
  const inputRef = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState<string>(CATEGORIES[0])

  const subscribe = useCallback((fn: () => void) => sessionPhotoStore.subscribe(fn), [])
  const getSnapshot = useCallback(() => sessionPhotoStore.photos, [])
  const getServerSnapshot = useCallback(() => sessionPhotoStore.photos, [])
  const photos = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) sessionPhotoStore.addPhoto(file, category, customerId)
    e.target.value = ''
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
            (proven broken 8/2, see device-proof/). */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
          className="hidden"
        />
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
                  className={`absolute right-1 top-1 size-2 rounded-full ${
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
    </section>
  )
}
