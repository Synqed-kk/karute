'use client'

// LIFTED FROM SPIKE (simplified)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute/TranscriptCollapse.tsx
//
// Recording + transcript card. Always renders; shows empty state
// when no recording exists yet. When a recording lands, this card
// shows:
//   - Consent badge (録音同意済み)
//   - Duration label
//   - Audio player (waveform + play button + scrubber) — STUBBED
//   - Speaker chips (staff / customer / background)
//   - Speaker-color-coded transcript bubbles with timestamps
//   - 重要 (important) badges on AI-flagged utterances
//
// ANTHONY: speaker diarization requires a separate AI pass after
// the raw transcript is generated. See AI_PROMPTS.md §6 in the
// spike. Pipeline:
//   1. Recording → Whisper for plain transcript (Anthony has this)
//   2. Plain transcript → diarization pass (NEW — assigns each
//      utterance a speaker_id)
//   3. Diarized transcript → "important moment" classifier (NEW)
// Audio playback uses Supabase Storage signed URLs (5-min TTL).
//
// What's STUBBED here:
//   - Audio player buttons render but don't play anything yet
//   - No utterance list rendered (the empty-state path is the
//     default — once Anthony wires the data, swap in real
//     utterances via props)

import { useState } from 'react'
import { ChevronDown, Mic, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'

export interface TranscriptUtterance {
  id: string
  speaker: 'staff' | 'customer' | 'unknown'
  speakerName?: string
  /** "MM:SS" or "HH:MM:SS" relative time */
  time: string
  text: string
  /** When true, renders a 重要 badge next to the utterance. */
  important?: boolean
}

interface Props {
  /** Whether a recording exists. When false, the body still renders
   *  the player + speaker scaffold (with placeholder duration + a
   *  "no recording yet" message in the transcript area) so staff
   *  sees the structure that'll populate once recording lands. */
  hasRecording?: boolean
  /** Display duration label, e.g. "58分14秒". Falls back to "—" in
   *  the player time display when omitted. */
  durationLabel?: string
  /** Display date for the consent badge ("2026-04-19"). */
  consentDate?: string
  /** Speaker-diarized utterances. Empty when diarization hasn't
   *  run yet — Anthony's pipeline backfills. */
  utterances?: TranscriptUtterance[]
  /** When true, the collapsible body starts open. Used by the
   *  KaruteAiAssistSheets bottom-sheet (the user just tapped to
   *  open the sheet — collapsing again would be redundant). */
  defaultOpen?: boolean
}

export function TranscriptCard({
  hasRecording = false,
  durationLabel,
  consentDate,
  utterances = [],
  defaultOpen = false,
}: Props) {
  const t = useTranslations('karute.transcript')
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-card p-4 border-b border-black/5 dark:border-white/5 md:p-5 md:border-0 md:rounded-xl md:ring-1 md:ring-rose-100 md:dark:ring-rose-500/20 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:dark:shadow-none">
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="-m-2 flex w-full items-center justify-between gap-3 rounded-md p-2 transition-colors hover:bg-muted/30"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white">
            <Mic className="size-3.5" />
          </div>
          <div className="min-w-0 text-left">
            <h3 className="text-sm font-semibold text-foreground">
              {t('title')}
            </h3>
            {durationLabel && (
              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {durationLabel}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasRecording && consentDate && (
            <span className="inline-flex h-5 items-center gap-1 rounded-full border border-green-200 bg-green-50 px-1.5 text-[10px] font-medium text-green-700 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300">
              <ShieldCheck className="size-2.5" />
              {t('consentLabel')}
            </span>
          )}
          <ChevronDown
            size={16}
            className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </div>
      </button>

      {/* Expanded body — player + speaker legend + utterances scaffold
       *  ALWAYS renders so the structure stays visible. Empty data
       *  states surface inside each sub-region rather than hiding
       *  the whole player. */}
      {open && (
        <div className="mt-3 border-t border-border/40 pt-3">
          {/* Audio player — stubbed (no real audio yet). Anthony
           *  wires a real <audio> element backed by a Supabase
           *  Storage signed URL. */}
          <div
            className="mb-3 flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5"
            title={t('comingSoonPlayer')}
          >
            <button
              type="button"
              disabled
              className="flex size-9 shrink-0 cursor-not-allowed items-center justify-center rounded-full bg-blue-600 text-white opacity-60"
              aria-label="play"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
            <div className="h-1.5 flex-1 rounded-full bg-muted">
              <div className="h-full w-0 rounded-full bg-blue-500" />
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              00:00 / {durationLabel ?? '—'}
            </span>
          </div>

          {/* Speaker legend — always visible so staff sees the
           *  diarization taxonomy the AI will populate. */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{t('speakers')}:</span>
            <SpeakerChip kind="staff" />
            <SpeakerChip kind="customer" />
            <SpeakerChip kind="unknown" />
          </div>

          {/* Utterance list — empty placeholder when no recording or
           *  diarization hasn't run. Real utterances render with
           *  speaker-color bubbles + 重要 badges where applicable. */}
          {utterances.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-[11px] italic leading-relaxed text-muted-foreground">
              {t('empty')}
            </p>
          ) : (
            <ul className="space-y-3">
              {utterances.map((u) => (
                <UtteranceRow key={u.id} utterance={u} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

const SPEAKER_CHIP_STYLE = {
  staff:
    'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20',
  customer:
    'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20',
  unknown:
    'bg-muted text-muted-foreground border border-border',
} as const

function SpeakerChip({ kind }: { kind: 'staff' | 'customer' | 'unknown' }) {
  const t = useTranslations('karute.transcript')
  const labelKey =
    kind === 'staff'
      ? 'speakerStaff'
      : kind === 'customer'
        ? 'speakerCustomer'
        : 'speakerUnknown'
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium ${SPEAKER_CHIP_STYLE[kind]}`}
    >
      {t(labelKey)}
    </span>
  )
}

function UtteranceRow({ utterance }: { utterance: TranscriptUtterance }) {
  const t = useTranslations('karute.transcript')
  const bubbleStyle =
    utterance.speaker === 'staff'
      ? 'bg-blue-50 dark:bg-blue-500/10'
      : utterance.speaker === 'customer'
        ? 'bg-rose-50 dark:bg-rose-500/10'
        : 'bg-muted/40'
  const nameLabel =
    utterance.speakerName ??
    t(
      utterance.speaker === 'staff'
        ? 'speakerStaff'
        : utterance.speaker === 'customer'
          ? 'speakerCustomer'
          : 'speakerUnknown',
    )
  return (
    <li className="flex items-start gap-3">
      <span className="w-12 shrink-0 pt-1 text-[10px] tabular-nums text-muted-foreground">
        {utterance.time}
      </span>
      <div className={`flex-1 rounded-lg p-2.5 ${bubbleStyle}`}>
        <div className="mb-1 flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-foreground">
            {nameLabel}
          </span>
          {utterance.important && (
            <span className="inline-flex h-4 items-center rounded bg-yellow-300 px-1 text-[9px] font-bold text-yellow-900">
              重要
            </span>
          )}
        </div>
        <p className="text-[12px] leading-relaxed text-foreground/90">
          {utterance.text}
        </p>
      </div>
    </li>
  )
}
