'use client'

// LIFTED FROM SPIKE (visual: verbatim; types: relocated)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute/photos/PhotoThumbnail.tsx
// Adaptations:
//   - Types imported from ./types (local) instead of spike's @/mock paths
//   - Label uses category.labelJa first; will be locale-switched once we
//     decide whether to thread the locale through props or read it here

import type { PhotoRecord, PhotoCategoryColor } from './types'
import { findCategoryByKey } from './types'

interface Props {
  photo: PhotoRecord
  onClick?: () => void
  selected?: boolean
  dimmed?: boolean
  className?: string
}

const badgeBg: Record<PhotoCategoryColor, string> = {
  blue: 'bg-blue-500/90',
  amber: 'bg-amber-500/90',
  green: 'bg-green-600/90',
  indigo: 'bg-indigo-500/90',
  rose: 'bg-rose-500/90',
  slate: 'bg-slate-500/90',
}

export function PhotoThumbnail({
  photo,
  onClick,
  selected = false,
  dimmed = false,
  className = '',
}: Props) {
  const category = findCategoryByKey(photo.categoryKey)
  const categoryLabel = category?.labelJa ?? photo.categoryLabelSnapshot
  const categoryColor = category?.color ?? 'slate'

  const interactive = typeof onClick === 'function'
  const Wrapper = interactive ? 'button' : 'div'

  return (
    <Wrapper
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      aria-label={
        interactive ? `${categoryLabel} · ${photo.capturedAtLabel}` : undefined
      }
      className={`
        group relative block aspect-square w-full overflow-hidden rounded-lg
        bg-gray-100 dark:bg-white/[0.04]
        ring-1 ring-black/5 dark:ring-white/10
        transition-all
        ${selected ? 'ring-2 ring-blue-500 dark:ring-blue-400 shadow-lg shadow-blue-500/20' : ''}
        ${dimmed ? 'opacity-40' : ''}
        ${interactive ? 'active:scale-[0.98] cursor-pointer' : ''}
        ${className}
      `}
    >
      {/* Plain <img>: spike intentionally bypasses next/image because
       *  Storage URLs at runtime are signed/ephemeral. Same here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.thumbnailUrl}
        alt={photo.caption ?? categoryLabel}
        loading="lazy"
        className="absolute inset-0 size-full object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/55 via-black/20 to-transparent"
      />
      <span
        className={`absolute left-1.5 top-1.5 inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-medium text-white backdrop-blur-[2px] ${badgeBg[categoryColor]}`}
      >
        {categoryLabel}
      </span>
      <span className="absolute inset-x-1.5 bottom-1.5 text-[10px] font-medium leading-none text-white tabular-nums">
        {photo.capturedAtLabel}
      </span>
      {selected && (
        <span className="absolute right-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-blue-500 text-[11px] font-semibold text-white">
          ✓
        </span>
      )}
    </Wrapper>
  )
}
