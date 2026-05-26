'use client'

// ─────────────────────────────────────────────────────────────
// PhotoCompareView — side-by-side + opacity-blended overlay
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/karute/photos/PhotoCompareView.tsx
//
// Two compare modes, toggled via a small tab strip:
//
//   side-by-side  — 2-column grid; works on any aspect ratio
//   overlay       — stacked with a 0..1 opacity slider blending
//                   the top image over the bottom. Best when
//                   both photos are the same category + same pose
//
// Spike skips landmark-based alignment — pure pixel blending. A
// production enhancement could add alignment without changing
// this component's interface (a, b).

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { findCategoryByKey, type PhotoRecord } from './types'

interface PhotoCompareViewProps {
  a: PhotoRecord
  b: PhotoRecord
}

type CompareMode = 'side' | 'overlay'

export function PhotoCompareView({ a, b }: PhotoCompareViewProps) {
  const t = useTranslations('karute.photoCompare')
  const [mode, setMode] = useState<CompareMode>('side')
  const [overlayOpacity, setOverlayOpacity] = useState(0.5)

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="inline-flex items-center rounded-lg bg-gray-100 p-0.5 ring-1 ring-black/5 dark:bg-white/[0.04] dark:ring-white/10">
        <ModeChip
          active={mode === 'side'}
          onClick={() => setMode('side')}
          label={t('sideBySide')}
        />
        <ModeChip
          active={mode === 'overlay'}
          onClick={() => setMode('overlay')}
          label={t('overlay')}
        />
      </div>

      {mode === 'side' ? (
        <div className="grid grid-cols-2 gap-2">
          <SidePanel photo={a} />
          <SidePanel photo={b} />
        </div>
      ) : (
        <OverlayPanel
          a={a}
          b={b}
          opacity={overlayOpacity}
          onOpacityChange={setOverlayOpacity}
          opacityLabel={t('opacity')}
        />
      )}
    </div>
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
      className={`inline-flex h-7 items-center rounded-md px-3 text-[12px] font-medium transition-colors ${
        active
          ? 'bg-card text-foreground shadow-sm dark:ring-1 dark:ring-white/10'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function SidePanel({ photo }: { photo: PhotoRecord }) {
  const category = findCategoryByKey(photo.categoryKey)
  const categoryLabel = category?.labelJa ?? photo.categoryLabelSnapshot
  return (
    <div className="space-y-1.5">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-gray-100 ring-1 ring-black/5 dark:bg-white/[0.04] dark:ring-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.storageUrl}
          alt={photo.caption ?? categoryLabel}
          className="absolute inset-0 size-full object-cover"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-muted-foreground">
          {categoryLabel}
        </span>
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-foreground">
          {photo.capturedAtLabel}
        </span>
      </div>
    </div>
  )
}

function OverlayPanel({
  a,
  b,
  opacity,
  onOpacityChange,
  opacityLabel,
}: {
  a: PhotoRecord
  b: PhotoRecord
  opacity: number
  onOpacityChange: (next: number) => void
  opacityLabel: string
}) {
  return (
    <div className="space-y-2">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-gray-100 ring-1 ring-black/5 dark:bg-white/[0.04] dark:ring-white/10">
        {/* Base image (chronologically earlier) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={a.storageUrl}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
        {/* Top image — opacity-controlled */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={b.storageUrl}
          alt=""
          style={{ opacity }}
          className="absolute inset-0 size-full object-cover transition-opacity"
        />
        {/* Date labels at the corners */}
        <span className="absolute left-2 top-2 inline-flex h-5 items-center rounded-full bg-black/55 px-2 text-[10px] font-medium tabular-nums text-white backdrop-blur-[2px]">
          {a.capturedAtLabel}
        </span>
        <span className="absolute right-2 top-2 inline-flex h-5 items-center rounded-full bg-blue-600/85 px-2 text-[10px] font-medium tabular-nums text-white backdrop-blur-[2px]">
          {b.capturedAtLabel}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[11px] text-muted-foreground">
          {opacityLabel}
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={opacity}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
          className="h-1.5 flex-1 accent-blue-600"
          aria-label={opacityLabel}
        />
        <span className="w-10 text-right text-[11px] font-medium tabular-nums text-foreground">
          {Math.round(opacity * 100)}%
        </span>
      </div>
    </div>
  )
}
