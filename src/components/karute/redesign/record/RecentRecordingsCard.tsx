'use client'

import { useTranslations } from 'next-intl'
import { Clock, FileText } from 'lucide-react'

import { Link } from '@/i18n/navigation'

export interface RecentRecording {
  id: string
  customerName: string
  initials: string
  karuteNumber: string | null
  service: string
  date: string
  startTime: string
  durationLabel: string
  karuteLinked: boolean
  entryCount: number
  /** Existing karute id when linked. */
  karuteId: string | null
}

interface RecentRecordingsCardProps {
  recordings: RecentRecording[]
}

export function RecentRecordingsCard({ recordings }: RecentRecordingsCardProps) {
  const t = useTranslations('recording.recent')

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center text-sky-400">
            <Clock size={14} />
          </span>
          <span className="text-sm font-semibold text-foreground">{t('title')}</span>
          <span className="text-[12px] tabular-nums text-muted-foreground">
            {recordings.length}
          </span>
        </div>
        <Link
          href={'/karute' as Parameters<typeof Link>[0]['href']}
          className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
        >
          {t('showAll')}
        </Link>
      </header>

      {recordings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {recordings.map((rec) => (
            <li
              key={rec.id}
              className="grid items-center gap-3 border-b border-border py-3 last:border-b-0 md:grid-cols-[36px_minmax(0,1fr)_140px_minmax(120px,auto)]"
            >
              {/* Play button removed — earlier render had no onClick and
               *  the recording-audio playback isn't wired (no signed
               *  URL from storage, no <audio> element, no transport).
               *  ANTHONY: when transcript playback ships, restore as a
               *  real <button onClick={() => seek(rec.id)}> with the
               *  lucide Play icon and a transport state. */}
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-foreground">
                {rec.initials}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {rec.customerName}
                  </span>
                  {rec.karuteNumber && (
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {rec.karuteNumber}
                    </span>
                  )}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">{rec.service}</div>
              </div>
              <div className="flex flex-col text-right text-[12px] tabular-nums md:text-left">
                <div className="text-foreground/80">{rec.date}</div>
                <div className="text-muted-foreground">
                  {rec.startTime} · {rec.durationLabel}
                </div>
              </div>
              <div className="text-right md:text-left">
                {rec.karuteLinked && rec.karuteId ? (
                  <Link
                    href={`/karute/${rec.karuteId}` as Parameters<typeof Link>[0]['href']}
                    className="inline-flex items-center gap-1 text-[12px] text-sky-400 hover:text-sky-300"
                  >
                    <FileText size={12} />
                    <span>{t('karuteCreated')}</span>
                    <span className="opacity-50">·</span>
                    <span className="tabular-nums">{t('entries', { n: rec.entryCount })}</span>
                  </Link>
                ) : (
                  <div className="inline-flex items-center gap-2">
                    <span className="text-[12px] text-muted-foreground">{t('notCreated')}</span>
                    {/* "Convert" button removed — earlier render had
                     *  no onClick. The transcript-to-karute conversion
                     *  flow isn't wired here (it normally lands via the
                     *  recording pipeline's ReviewScreen + saveKarute).
                     *  ANTHONY: when manual "promote orphan recording
                     *  to karute" is wired, restore as a button that
                     *  calls a server action with rec.id. */}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
