'use client'

// ─────────────────────────────────────────────────────────────
// PhotoCategoryPicker — chip-style picker
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/karute/photos/PhotoCategoryPicker.tsx
// Two render modes share one chip visual:
//
//   mode="single"  → radio-style. Used inside PhotoCaptureDialog
//                    to tag a new photo.
//   mode="filter"  → multi-state with an "All" sentinel. Used as
//                    the filter row in PhotoGallerySheet.

import { useLocale } from 'next-intl'

import type { PhotoCategory, PhotoCategoryColor } from './types'

interface BaseProps {
  categories: PhotoCategory[]
  className?: string
}

interface SingleProps extends BaseProps {
  mode: 'single'
  value: string | null
  onChange: (key: string) => void
}

interface FilterProps extends BaseProps {
  mode: 'filter'
  /** null = "All" sentinel selected. */
  value: string | null
  onChange: (key: string | null) => void
  allLabel: string
}

type Props = SingleProps | FilterProps

// Tailwind JIT-safe lookup — every class string visible at build time.
const chipActive: Record<PhotoCategoryColor, string> = {
  blue: 'bg-blue-600 text-white ring-1 ring-blue-600',
  amber: 'bg-amber-600 text-white ring-1 ring-amber-600',
  green: 'bg-green-600 text-white ring-1 ring-green-600',
  indigo: 'bg-indigo-600 text-white ring-1 ring-indigo-600',
  rose: 'bg-rose-600 text-white ring-1 ring-rose-600',
  slate: 'bg-slate-700 text-white ring-1 ring-slate-700',
}

const chipIdle =
  'bg-card text-foreground/80 ring-1 ring-black/10 dark:ring-white/10 hover:ring-black/20 dark:hover:ring-white/20'

export function PhotoCategoryPicker(props: Props) {
  const locale = useLocale()
  const { categories, className = '' } = props

  const label = (c: PhotoCategory): string =>
    locale === 'en' && c.labelEn ? c.labelEn : c.labelJa

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {props.mode === 'filter' && (
        <button
          type="button"
          onClick={() => props.onChange(null)}
          className={`inline-flex h-7 items-center rounded-full px-3 text-[12px] font-medium transition-colors ${
            props.value === null ? chipActive.slate : chipIdle
          }`}
        >
          {props.allLabel}
        </button>
      )}
      {categories.map((c) => {
        const active = props.value === c.key
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              if (props.mode === 'single') props.onChange(c.key)
              else props.onChange(active ? null : c.key)
            }}
            aria-pressed={active}
            className={`inline-flex h-7 items-center whitespace-nowrap rounded-full px-3 text-[12px] font-medium transition-colors ${
              active ? chipActive[c.color] : chipIdle
            }`}
          >
            {label(c)}
          </button>
        )
      })}
    </div>
  )
}
