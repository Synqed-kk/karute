'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface TranscriptSectionProps {
  transcript: string | null
}

/**
 * Collapsible transcript section.
 * Per user decision: collapsed by default, click heading to expand.
 * Shows first ~2 lines as preview when collapsed.
 */
export function TranscriptSection({ transcript }: TranscriptSectionProps) {
  const [isOpen, setIsOpen] = useState(false)
  const t = useTranslations('karute')

  if (!transcript) return null

  // Preview: first 160 characters
  const preview = transcript.length > 160 ? transcript.slice(0, 160) + '…' : transcript

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/50"
        aria-expanded={isOpen}
      >
        <span className="text-sm font-semibold text-foreground">
          {t('transcript')}
        </span>
        {isOpen ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>

      <div className="px-4 pb-4">
        {isOpen ? (
          <p className="whitespace-pre-wrap text-sm text-foreground/80">
            {transcript}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {preview}
          </p>
        )}
      </div>
    </div>
  )
}
