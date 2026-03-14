'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { ENTRY_CATEGORIES } from '@/lib/karute/categories'
import type { EntryCategory } from '@/lib/karute/categories'
import { addManualEntry } from '@/actions/entries'
import { cn } from '@/lib/utils'

interface AddEntryFormProps {
  karuteRecordId: string
}

/**
 * Inline always-visible form for adding a manual entry.
 * Per user decision: category-first — pick a category badge, then type content.
 * Minimal fields: category + content only.
 */
export function AddEntryForm({ karuteRecordId }: AddEntryFormProps) {
  const t = useTranslations('karute')
  const [isPending, startTransition] = useTransition()
  const [selectedCategory, setSelectedCategory] = useState<EntryCategory | null>(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCategory || !content.trim()) return

    setError(null)

    startTransition(async () => {
      const result = await addManualEntry({
        karuteRecordId,
        category: selectedCategory,
        content: content.trim(),
      })

      if (result.error) {
        setError(result.error)
      } else {
        // Clear form on success
        setSelectedCategory(null)
        setContent('')
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-card p-3 space-y-3"
    >
      {/* Category selector row */}
      <div className="flex flex-wrap gap-1.5">
        {ENTRY_CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            type="button"
            onClick={() =>
              setSelectedCategory(
                selectedCategory === cat.value ? null : (cat.value as EntryCategory),
              )
            }
            className={cn(
              'inline-flex min-h-[44px] items-center rounded-full border px-3 py-1 text-xs font-medium transition-all',
              cat.color,
              selectedCategory === cat.value
                ? 'ring-2 ring-offset-1 ring-offset-card ring-current opacity-100'
                : 'opacity-60 hover:opacity-80',
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Content textarea */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t('addEntry')}
        rows={2}
        className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        disabled={isPending}
      />

      {/* Error */}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Submit */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!selectedCategory || !content.trim() || isPending}
          className="min-h-[44px] rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-40 hover:opacity-90"
        >
          {isPending ? t('saving') : t('addEntry')}
        </button>
      </div>
    </form>
  )
}
