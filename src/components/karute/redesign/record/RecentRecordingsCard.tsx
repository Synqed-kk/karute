'use client'

import { useTranslations } from 'next-intl'
import { Clock, FileText } from 'lucide-react'

import { Link } from '@/i18n/navigation'

// Feature flag — flip in .env when the orphan-recording→karute path ships.
const FEATURE_RECORDING_CONVERT =
  process.env.NEXT_PUBLIC_FEATURE_RECORDING_CONVERT === 'true'

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
          <span className="flex h-6 w-6 items-center justify-center text-muted-foreground">
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
              className="flex items-center gap-3 border-b border-border/60 py-3 last:border-b-0"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-foreground">
                {rec.initials}
              </span>
              {/* Middle — name + karute # on top, date · time below. flex-1 so the
               *  name gets the room (it was squeezing to one character before). */}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {rec.customerName}
                  </span>
                  {rec.karuteNumber && (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {rec.karuteNumber}
                    </span>
                  )}
                </div>
                <div className="truncate text-[12px] tabular-nums text-muted-foreground">
                  {rec.date}
                  {rec.startTime ? ` · ${rec.startTime}` : ''}
                  {rec.durationLabel && rec.durationLabel !== '—'
                    ? ` · ${rec.durationLabel}`
                    : ''}
                </div>
              </div>
              {/* Right — just the file icon + entry count (dark blue), like the
               *  spike; or the convert affordance when it isn't a karute yet. */}
              {rec.karuteLinked && rec.karuteId ? (
                <Link
                  href={`/karute/${rec.karuteId}` as Parameters<typeof Link>[0]['href']}
                  aria-label={t('karuteCreated')}
                  className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  <FileText size={14} />
                  <span className="tabular-nums">{t('entries', { n: rec.entryCount })}</span>
                </Link>
              ) : (
                <div className="inline-flex shrink-0 items-center gap-2">
                  <span className="text-[12px] text-muted-foreground">{t('notCreated')}</span>
                  {/* ANTHONY: add promoteRecordingToKarute(recordingId) — reads the
                   *  transcript + entries off the recording row + inserts a DRAFT
                   *  karute_records row; the onClick calls it. Gated until then. */}
                  {FEATURE_RECORDING_CONVERT && (
                    <button
                      type="button"
                      className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-500/15 dark:text-blue-400"
                    >
                      {t('convert')}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
