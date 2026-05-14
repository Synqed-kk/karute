'use client'

import { useTranslations } from 'next-intl'
import { Mic } from 'lucide-react'

interface RecordButtonCardProps {
  customerName: string | null
  isRecording: boolean
  elapsedSeconds: number
  onStart: () => void
  onStop: () => void
  /** 0-1 normalized waveform bars (already smoothed). Length sets bar count. */
  waveform?: number[]
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function formatElapsed(sec: number): string {
  return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`
}

const DEFAULT_BARS = 24

export function RecordButtonCard({
  customerName,
  isRecording,
  elapsedSeconds,
  onStart,
  onStop,
  waveform,
}: RecordButtonCardProps) {
  const t = useTranslations('recording.button')
  const bars = waveform && waveform.length > 0 ? waveform : Array.from({ length: DEFAULT_BARS }, (_, i) => 0.3 + ((i * 17) % 60) / 100)

  if (isRecording) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-7 shadow-sm">
        <div className="relative">
          <button
            type="button"
            onClick={onStop}
            aria-label={t('stopAria')}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/40 transition-colors hover:bg-red-600"
          >
            <span className="h-5 w-5 rounded-sm bg-white" />
          </button>
          <span className="pointer-events-none absolute inset-0 -m-2 rounded-full border-2 border-red-500/40 motion-safe:animate-ping" />
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-red-500">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 motion-safe:animate-pulse" />
          {t('recording')}
        </div>
        <div className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
          {formatElapsed(elapsedSeconds)}
        </div>
        <div className="flex h-10 items-end gap-[3px]">
          {bars.map((v, i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-red-500/70"
              style={{ height: `${Math.max(15, Math.min(100, v * 100))}%` }}
            />
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-7 shadow-sm">
      <button
        type="button"
        onClick={onStart}
        aria-label={t('startAria')}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/40 transition-colors hover:bg-red-600"
      >
        <Mic size={26} className="text-white" strokeWidth={2.2} />
      </button>
      <div className="text-base font-semibold text-foreground">{t('startTitle')}</div>
      <div className="text-[13px] text-muted-foreground">
        {t('startSub', { name: customerName ?? '—' })}
      </div>
    </section>
  )
}
