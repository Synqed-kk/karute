'use client'

import { useTranslations } from 'next-intl'
import { Image as ImageIcon } from 'lucide-react'

export interface PhotoRecord {
  id: string
  signedUrl: string | null
  category: string
  caption: string | null
}

interface PhotoRecordsCardProps {
  photos: PhotoRecord[]
}

const CATEGORY_TONE: Record<string, { bg: string; text: string }> = {
  before: { bg: '#3b82f6', text: '#ffffff' },
  after: { bg: '#16a34a', text: '#ffffff' },
  reference: { bg: '#7c3aed', text: '#ffffff' },
  progress: { bg: '#0891b2', text: '#ffffff' },
}

function toneFor(category: string) {
  return CATEGORY_TONE[category] ?? { bg: 'var(--muted)', text: 'var(--muted-foreground)' }
}

export function PhotoRecordsCard({ photos }: PhotoRecordsCardProps) {
  const t = useTranslations('karuteDetail')

  if (photos.length === 0) return null

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-500">
            <ImageIcon size={16} />
          </div>
          <div>
            <div className="text-base font-semibold text-foreground">
              {t('photos.title')}
            </div>
            <div className="text-[13px] text-muted-foreground">
              {t('photos.subtitle')}
            </div>
          </div>
        </div>
        {/* "Show to customer" eye toggle removed — earlier render had
         *  local boolean state that styled the button itself but never
         *  propagated anywhere else, so clicking on/off changed
         *  nothing the customer sees. ANTHONY: when a real "presenter
         *  mode" overlay ships (probably a full-screen photo viewer
         *  the staff turns the phone to show the customer), restore
         *  this button to trigger it. */}
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {photos.map((p) => {
          const tone = toneFor(p.category)
          return (
            <div
              key={p.id}
              className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted"
            >
              {p.signedUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={p.signedUrl}
                  alt={p.caption ?? p.category}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[11px] uppercase tracking-widest text-muted-foreground">
                  photo
                </div>
              )}
              <span
                className="absolute left-2 top-2 inline-flex h-[22px] items-center rounded-md px-2 text-[11px] font-semibold"
                style={{ background: tone.bg, color: tone.text }}
              >
                {p.category}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
