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
 *  is no state to invent.
 *
 *  RECORDING is kept in the set but is now unreachable HERE (fix round 1): the
 *  server only reports `audioPresent` once it actually holds the take
 *  (serverHoldsTakeRow), and a row still at RECORDING never passes that. Left
 *  in rather than trimmed — this set answers "are the words still coming?", and
 *  narrowing it to today's reachable subset would tie a display question to a
 *  server rule it does not own. */
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
        // ⚠ KEYED BY THE KARUTE (reviewer P1). Web same-route navigation from one
        // karute to another reuses this component in the same tree position, so
        // without the key the minted URL and the loaded <audio> element stayed
        // the PREVIOUS karute's: a play tap on B played A's recording, with no
        // mint and no `recording.play` row for the karute actually on screen.
        // The key forces a remount, and the unmount effect already pauses and
        // releases the element.
        <RecordingPlayer
          key={karuteId}
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
              // The customer's own words, never a UI string — marked so the
              // catalog law (recording-player-card.test.tsx) can tell the two
              // apart instead of having to allow arbitrary text.
              <div
                data-transcript-body
                className="border-t border-border p-5 text-sm leading-relaxed text-foreground/85 md:p-6"
              >
                {transcript}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
                {/* ⚠ NEUTRAL, NOT ACCENT (reviewer P2). This chip is a STATUS
                 *  indicator, not a control — the one-way accent law reserves
                 *  saturated accent for things a staffer can press, and a static
                 *  label wearing the pressable idiom invites a tap that does
                 *  nothing. The 同意確認済 chip beside it keeps emerald because
                 *  that is a semantic status colour, not the accent. */}
                <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] font-semibold text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-pulse" />
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
