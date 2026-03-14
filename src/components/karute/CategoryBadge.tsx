'use client'

import { useTranslations } from 'next-intl'
import { getCategoryConfig } from '@/lib/karute/categories'
import { cn } from '@/lib/utils'

interface CategoryBadgeProps {
  category: string
  className?: string
}

/**
 * Color-coded pill badge for an entry category.
 * Uses ENTRY_CATEGORIES color classes. Falls back to 'other' for unknown values.
 * Category label is translated via the karute.categories namespace.
 */
export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  const t = useTranslations('karute.categories')
  const config = getCategoryConfig(category)

  // Use the translation key if available, fall back to config.label
  let label: string
  try {
    label = t(config.value as Parameters<typeof t>[0])
  } catch {
    label = config.label
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        config.color,
        className,
      )}
    >
      {label}
    </span>
  )
}
