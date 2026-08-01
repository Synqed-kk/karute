'use client'

// PhotoCompareView — before/after compare mode for the Photos tab.
// Restored from the pre-redesign spike lift (commit ecce3cdd,
// spike-lifted/photos/PhotoCompareView.tsx) that the 5/14 profile
// redesign dropped and #281's upload-only restore didn't bring back.
// Reworked onto the current design tokens (rounded-xl cards, the tab's
// tone system, text-[11px]/[12px] scale) and the live CustomerPhoto
// shape — there's no capturedAtLabel on this prop, so corner badges
// show the category instead of a date.
//
// Flow: staff taps thumbnails to pick two photos (rolling selection —
// picking a third swaps out the first pick), then once two are picked
// a small tab strip switches between side-by-side and an opacity-
// blended overlay, exactly like the spike's two compare modes.

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  KNOWN_CATEGORIES,
  toneFor,
  type CustomerPhoto,
} from './PhotosTabContent'

type Translate = ReturnType<typeof useTranslations<'customers.photos'>>
type PickablePhoto = CustomerPhoto & { signedUrl: string }
type CompareMode = 'side' | 'overlay'

interface PhotoCompareViewProps {
  photos: CustomerPhoto[]
}

function labelFor(t: Translate, category: string) {
  return KNOWN_CATEGORIES.includes(category) ? t(category) : category
}

export function PhotoCompareView({ photos }: PhotoCompareViewProps) {
  const t = useTranslations('customers.photos')
  const pickable = photos.filter((p): p is PickablePhoto => Boolean(p.signedUrl))

  // Preselect only the unambiguous case: exactly one before + one after.
  // Anything messier (several of either, or neither present) leaves the
  // picker empty rather than guessing which two the staff member means.
  const [picked, setPicked] = useState<string[]>(() => {
    const befores = pickable.filter((p) => p.category === 'before')
    const afters = pickable.filter((p) => p.category === 'after')
    if (befores.length === 1 && afters.length === 1) {
      return [befores[0]!.id, afters[0]!.id]
    }
    return []
  })
  const [mode, setMode] = useState<CompareMode>('side')
  const [opacity, setOpacity] = useState(0.5)

  function togglePick(id: string) {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length < 2) return [...prev, id]
      return [prev[1]!, id] // rolling: drop the oldest pick, add the new one
    })
  }

  const photoA = picked[0] ? pickable.find((p) => p.id === picked[0]) : undefined
  const photoB = picked[1] ? pickable.find((p) => p.id === picked[1]) : undefined
  const ready = Boolean(photoA && photoB)

  return (
    <section className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {ready ? t('comparePickHintDone') : t('comparePickHint')}
      </p>

      {ready && photoA && photoB && (
        <div className="space-y-3">
          <div className="inline-flex items-center rounded-lg bg-muted p-0.5 ring-1 ring-border">
            <ModeChip
              active={mode === 'side'}
              onClick={() => setMode('side')}
              label={t('compareSideBySide')}
            />
            <ModeChip
              active={mode === 'overlay'}
              onClick={() => setMode('overlay')}
              label={t('compareOverlay')}
            />
          </div>

          {mode === 'side' ? (
            <div className="grid grid-cols-2 gap-3">
              <ComparePanel photo={photoA} t={t} />
              <ComparePanel photo={photoB} t={t} />
            </div>
          ) : (
            <OverlayPanel
              a={photoA}
              b={photoB}
              opacity={opacity}
              onOpacityChange={setOpacity}
              t={t}
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
        {pickable.map((photo) => {
          const label = labelFor(t, photo.category)
          const selected = picked.includes(photo.id)
          const tone = toneFor(photo.category)
          return (
            <button
              key={photo.id}
              type="button"
              onClick={() => togglePick(photo.id)}
              aria-label={label}
              aria-pressed={selected}
              className={`group relative aspect-square overflow-hidden rounded-xl border bg-background/40 transition-colors ${
                selected ? 'border-sky-500 ring-2 ring-sky-500' : 'border-border'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.signedUrl}
                alt={photo.caption ?? label}
                className="h-full w-full object-cover"
              />
              <span
                className={`absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tone.bg} ${tone.text}`}
              >
                {label}
              </span>
              {selected && (
                <span className="absolute right-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-sky-500 text-white">
                  <Check size={12} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ModeChip({
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
      className={`inline-flex h-7 items-center rounded-md px-3 text-[12px] font-medium transition-colors ${
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function ComparePanel({ photo, t }: { photo: PickablePhoto; t: Translate }) {
  const label = labelFor(t, photo.category)
  const tone = toneFor(photo.category)
  return (
    <div className="space-y-1.5">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.signedUrl}
          alt={photo.caption ?? label}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <span
          className={`absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tone.bg} ${tone.text}`}
        >
          {label}
        </span>
      </div>
      {photo.caption && (
        <p className="line-clamp-2 text-[11px] text-muted-foreground">{photo.caption}</p>
      )}
    </div>
  )
}

function OverlayPanel({
  a,
  b,
  opacity,
  onOpacityChange,
  t,
}: {
  a: PickablePhoto
  b: PickablePhoto
  opacity: number
  onOpacityChange: (next: number) => void
  t: Translate
}): ReactNode {
  const labelA = labelFor(t, a.category)
  const labelB = labelFor(t, b.category)
  return (
    <div className="space-y-2">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
        {/* Base image (first pick) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a.signedUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        {/* Top image — opacity-controlled */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={b.signedUrl}
          alt=""
          style={{ opacity }}
          className="absolute inset-0 h-full w-full object-cover transition-opacity"
        />
        <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-[2px]">
          {labelA}
        </span>
        <span className="absolute right-1.5 top-1.5 rounded-full bg-sky-600/85 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-[2px]">
          {labelB}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
          {t('compareOpacity')}
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={opacity}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
          aria-label={t('compareOpacity')}
          className="h-1.5 flex-1 accent-sky-600"
        />
        <span className="w-10 text-right text-[11px] font-medium tabular-nums text-foreground">
          {Math.round(opacity * 100)}%
        </span>
      </div>
    </div>
  )
}
