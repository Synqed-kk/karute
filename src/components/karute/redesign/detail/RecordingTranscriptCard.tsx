'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, ChevronDown, Mic } from 'lucide-react'

import { cn } from '@/lib/utils'

interface RecordingTranscriptCardProps {
  transcript: string | null
  consentOnFile: boolean
  /** Pre-formatted duration ("12:34" or "—"). */
  durationLabel?: string | null
}

export function RecordingTranscriptCard({
  transcript,
  consentOnFile,
  durationLabel,
}: RecordingTranscriptCardProps) {
  const t = useTranslations('karuteDetail')
  const [open, setOpen] = useState(false)
  if (!transcript) return null

  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <header className="flex items-center gap-3 p-4">
        <Mic size={16} className="shrink-0 text-sky-500" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {t('transcript.title')}
            </span>
            {consentOnFile && (
              <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 text-[11px] font-semibold text-emerald-500">
                <CheckCircle2 size={11} />
                <span>{t('transcript.consentOnFile')}</span>
              </span>
            )}
          </div>
          {durationLabel && (
            <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {t('transcript.duration', { duration: durationLabel })}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronDown
            size={14}
            className={cn('transition-transform', open && 'rotate-180')}
          />
        </button>
      </header>
      {open && (
        <div className="border-t border-border p-5 text-sm leading-relaxed text-foreground/85 md:p-6">
          {transcript}
        </div>
      )}
    </section>
  )
}
