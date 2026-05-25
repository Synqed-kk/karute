'use client'

// LIFTED FROM SPIKE
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute/MobileKaruteSheets.tsx
//
// Mobile-only: a pair of list-style rows ("AI要約" + "録音・文字起こし")
// rendered as compact buttons at the bottom of the karute detail
// page. Tapping each opens a bottom Sheet (slides up from the bottom
// of the viewport) with the full surface inside.
//
// Returns null on md+ via Tailwind — desktop already renders the
// AISummary + Transcript cards inline in the sidebar column. This
// component is the mobile-only sheet trigger pair the spike uses
// to avoid a giant vertical scroll on phones.
//
// ANTHONY: the sheet contents are placeholders (no audio data, no
// real AI summary). When you wire the AI summary generator + the
// recording storage, swap the placeholder body for the real
// content. The button rows themselves stay — they're the trigger
// surface.

import { useState } from 'react'
import { ChevronRight, FileText, Mic } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { TranscriptCard } from './transcript/TranscriptCard'

interface Props {
  /** Pretty session date — shown as the AI Summary sheet's
   *  subtitle. */
  sessionDate?: string
  /** Recording length display ("58分14秒"). Undefined when no
   *  recording — the row shows the empty subtitle instead. */
  transcriptDurationLabel?: string
  /** Whether a recording has been captured for this session. When
   *  false, the transcript sheet renders the empty-state body. */
  hasRecording?: boolean
}

export function KaruteAiAssistSheets({
  sessionDate,
  transcriptDurationLabel,
  hasRecording = false,
}: Props) {
  const t = useTranslations('karute.aiAssist')
  const tTranscript = useTranslations('karute.transcript')
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)

  return (
    <>
      <div className="mt-4 md:hidden">
        <div className="mb-2 px-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('heading')}
        </div>
        <div className="mx-4 divide-y divide-black/5 rounded-xl bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-black/5 dark:divide-white/5 dark:ring-white/5">
          <button
            type="button"
            onClick={() => setSummaryOpen(true)}
            className="flex min-h-[56px] w-full items-center gap-3 rounded-t-xl px-4 py-3.5 transition-colors active:bg-black/5"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10">
              <FileText className="size-4" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <div className="text-[15px] font-medium text-foreground">
                {t('summaryTitle')}
              </div>
              <div className="truncate text-[12px] text-muted-foreground">
                {t('summarySubtitle')}
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-gray-400 dark:text-gray-500" />
          </button>
          <button
            type="button"
            onClick={() => setTranscriptOpen(true)}
            className="flex min-h-[56px] w-full items-center gap-3 rounded-b-xl px-4 py-3.5 transition-colors active:bg-black/5"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-gray-300">
              <Mic className="size-4" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <div className="text-[15px] font-medium text-foreground">
                {tTranscript('title')}
              </div>
              <div className="truncate text-[12px] text-muted-foreground">
                {transcriptDurationLabel ?? t('transcriptSubtitleEmpty')}
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-gray-400 dark:text-gray-500" />
          </button>
        </div>
      </div>

      {/* AI Summary sheet — body is currently a placeholder. Swap in
       *  the real summary component when Anthony wires generation. */}
      <Sheet open={summaryOpen} onOpenChange={setSummaryOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t('summaryTitle')}</SheetTitle>
            <SheetDescription>{sessionDate ?? '—'}</SheetDescription>
          </SheetHeader>
          <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-[12px] italic leading-relaxed text-muted-foreground">
            {t('summarySubtitle')}
          </div>
        </SheetContent>
      </Sheet>

      {/* Transcript sheet — embeds the lifted TranscriptCard with its
       *  expanded body (the card auto-expands inside the sheet via
       *  its internal state). */}
      <Sheet open={transcriptOpen} onOpenChange={setTranscriptOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{tTranscript('title')}</SheetTitle>
            <SheetDescription>
              {transcriptDurationLabel ?? t('transcriptSubtitleEmpty')}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-3">
            <TranscriptCard
              hasRecording={hasRecording}
              durationLabel={transcriptDurationLabel}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
