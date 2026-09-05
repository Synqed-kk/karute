'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, ChevronDown, Lock, Mic } from 'lucide-react'

import { cn } from '@/lib/utils'
import { RecordingPlayer } from './RecordingPlayer'
import type { KaruteDetailRecording } from '@/lib/karute/detail-screen'

/** Statuses whose transcript has not landed YET — the audio is already safe, so
 *  the card shows the player plus an honest "still working on the words" body
 *  (mock frame F6). Anything else with no transcript has no body at all: there
 *  is no state to invent. */
const PENDING_STATUSES = new Set(['RECORDING', 'UPLOADING', 'PROCESSING'])

interface RecordingTranscriptCardProps {
  karuteId: string
  transcript: string | null
  consentOnFile: boolean
  /** Pre-formatted duration ("12:34" or "—"). */
  durationLabel?: string | null
  /** A transcript EXISTS but the viewer isn't the recording staff (and lacks
   *  recordings.viewAll), so the raw text is withheld — show a locked notice
   *  instead of the transcript. The shared AI summary is unaffected. */
  restricted?: boolean
  /** The audio behind this karute, AS THE VIEWER MAY HEAR IT — server-decided
   *  (detail-screen.ts). null/absent = no player, and this card says NOTHING
   *  about one: an old record looks exactly as it did before the player
   *  existed (⚖ 9/3, mock frame F5). */
  recording?: KaruteDetailRecording | null
}

export function RecordingTranscriptCard({
  karuteId,
  transcript,
  consentOnFile,
  durationLabel,
  restricted,
  recording,
}: RecordingTranscriptCardProps) {
  const t = useTranslations('karuteDetail')
  const hasPlayer = Boolean(recording?.audioPresent)
  const pending = !transcript && hasPlayer && PENDING_STATUSES.has(recording?.status ?? '')
  // The processing body opens itself: the one thing there is to say about this
  // card is already inside it, and a chevron nobody turns says nothing.
  const [open, setOpen] = useState(pending)

  // Private to the recording staff — never reveal the transcript text, just
  // explain why it's hidden.
  if (restricted) {
    return (
      <section className="rounded-2xl border border-border bg-card shadow-sm">
        <header className="flex items-center gap-3 p-4">
          <Lock size={16} className="shrink-0 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">
            {t('transcript.restrictedTitle')}
          </span>
        </header>
        <p className="border-t border-border p-4 text-xs leading-relaxed text-muted-foreground">
          {t('transcript.restricted')}
        </p>
      </section>
    )
  }

  if (!transcript && !hasPlayer) return null

  const body = Boolean(transcript) || pending

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
          {/* NOT when a player is present (mock D-6): the scrub row already
           *  states the total, and two different lengths for one recording is
           *  the bug this line would reintroduce. */}
          {durationLabel && !hasPlayer && (
            <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {t('transcript.duration', { duration: durationLabel })}
            </div>
          )}
        </div>
        {body && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronDown
              size={14}
              className={cn(
                'transition-transform duration-(--duration-press) ease-(--ease-out)',
                open && 'rotate-180',
              )}
            />
          </button>
        )}
      </header>
      {hasPlayer && (
        <RecordingPlayer
          karuteId={karuteId}
          durationSeconds={recording?.durationSeconds ?? null}
        />
      )}
      {/* Always mounted (not conditional on `open`) so the grid-rows tween can
       *  animate; the inner overflow-hidden div clips via the child, not the
       *  row, since a CSS grid row can't itself clip content. Pre-Chrome-107 /
       *  pre-Safari-16.4 engines snap instead of animating grid-template-rows
       *  — accepted degradation, layout stays correct either way. */}
      {body && (
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-(--duration-modal) ease-(--ease-out)',
            open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
          aria-hidden={!open}
        >
          <div className="overflow-hidden min-h-0">
            {transcript ? (
              <div className="border-t border-border p-5 text-sm leading-relaxed text-foreground/85 md:p-6">
                {transcript}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
                <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-primary/8 px-2.5 text-[11px] font-semibold text-primary">
                  <span className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
                  <span>{t('transcript.processing')}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('transcript.processingHint')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
