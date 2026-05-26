'use client'

import { useTranslations } from 'next-intl'
import { Radio } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface LiveTranscriptLine {
  id: string
  speaker: 'customer' | 'staff'
  speakerName?: string | null
  text: string
}

interface LiveTranscriptCardProps {
  connected: boolean
  lines: LiveTranscriptLine[]
}

export function LiveTranscriptCard({ connected, lines }: LiveTranscriptCardProps) {
  const t = useTranslations('recording.liveTranscript')
  // Gate the entire card on backing data being present.
  if (lines.length === 0) return null

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/15 text-red-500">
          <Radio size={14} />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold text-foreground">{t('title')}</span>
          <span className="text-[12px] text-muted-foreground">{t('sub')}</span>
        </div>
        <span
          className={cn(
            'ml-auto inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold',
            connected
              ? 'bg-emerald-500/15 text-emerald-500'
              : 'bg-foreground/8 text-muted-foreground',
          )}
        >
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              connected ? 'bg-emerald-500' : 'bg-muted-foreground',
            )}
          />
          {connected ? t('connected') : t('disconnected')}
        </span>
      </header>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {lines.map((line) => {
          const isCustomer = line.speaker === 'customer'
          return (
            <li
              key={line.id}
              className={cn(
                'rounded-xl border px-3.5 py-2.5',
                isCustomer
                  ? 'border-pink-500/25 bg-pink-500/8'
                  : 'border-sky-500/25 bg-sky-500/8',
              )}
            >
              <div
                className={cn(
                  'mb-1 text-[11px] font-semibold',
                  isCustomer ? 'text-pink-400' : 'text-sky-400',
                )}
              >
                {isCustomer
                  ? t('speakerCustomer')
                  : t('speakerStaff', { name: line.speakerName ?? '—' })}
              </div>
              <div className="text-[13px] leading-snug text-foreground/85">{line.text}</div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
