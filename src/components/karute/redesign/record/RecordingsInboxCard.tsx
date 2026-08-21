'use client'

/**
 * 録音履歴 — the inbox section on the record page (Build F1, approved mock
 * `mock-f1-inbox.html` §1).
 *
 * One row per recording session, always. The row says what is TRUE about that
 * session and offers the one thing that can still be done about it — nothing
 * else. Rows never disappear; a resolved one just changes state.
 *
 * Colour: every state chip is a soft wash with dark text (R13 — no solid fills
 * on a non-pressable), the only solid `bg-primary` is 保存する (the commit), and
 * 確認する is the R13 selected-state recipe. 開く / 再試行 are quiet links.
 */

import { useTranslations } from 'next-intl'
import { Check, Eye, History, Save, X } from 'lucide-react'

import { formatCompactDateJst, hmInJst, ymdInJst } from '@/lib/date/jst'
import type { InboxRow, InboxState } from '@/lib/recordings/inbox'

export interface RecordingsInboxCardProps {
  rows: InboxRow[]
  needsAttention: number
  /** True when the server half of the read failed — the list is incomplete and
   *  the card says so rather than reading clean. */
  serverFailed: boolean
  locale: string
  /** Name lookup for rows whose take carries no bind-time snapshot. */
  customerNameById: ReadonlyMap<string, string>
  /** 開く / 確認する — the karute this session produced. */
  onOpenRecord: (row: InboxRow) => void
  /** 保存する / 再試行 — hand this take's audio to the recovery save. */
  onSaveTake: (row: InboxRow) => void
}

const STATE_LABEL: Record<InboxState, string> = {
  saved: 'saved',
  'awaiting-check': 'awaitingCheck',
  processing: 'processing',
  failed: 'failed',
  recoverable: 'recoverable',
}

/** Wash + dark text for every chip. Semantic colours (green/amber/red) and
 *  wash-level blue are both outside the one-way accent law. */
const CHIP_CLASS: Record<InboxState, string> = {
  saved:
    'bg-green-50 text-green-800 border-green-200 dark:bg-green-500/15 dark:text-green-200 dark:border-green-500/30',
  'awaiting-check':
    'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30',
  processing:
    'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  failed:
    'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/30',
  recoverable:
    'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/30',
}

export function RecordingsInboxCard({
  rows,
  needsAttention,
  serverFailed,
  locale,
  customerNameById,
  onOpenRecord,
  onSaveTake,
}: RecordingsInboxCardProps) {
  const t = useTranslations('recording.inbox')
  const tRec = useTranslations('recording')

  const todayYmd = ymdInJst(new Date())
  const yesterdayYmd = ymdInJst(new Date(Date.now() - 24 * 60 * 60 * 1000))

  function dayLabel(startedAt: number): string {
    const ymd = ymdInJst(new Date(startedAt))
    if (ymd === todayYmd) return t('today')
    if (ymd === yesterdayYmd) return t('yesterday')
    return formatCompactDateJst(new Date(startedAt), locale)
  }

  function nameFor(row: InboxRow): string {
    if (row.customerName) return row.customerName
    if (!row.customerId) return t('unsetCustomer')
    return customerNameById.get(row.customerId) ?? tRec('recoverCustomerUnknown')
  }

  function reasonFor(row: InboxRow): string | null {
    if (!row.reason) return null
    // The one error core names keeps the SAME honest string the pipeline error
    // card shows — one wording for one failure, on every surface.
    if (row.reason === 'emptyTranscript') return tRec('pipelineErrorEmptyTranscript')
    return t(`reason.${row.reason}` as 'reason.transcribing')
  }

  // Day headers are emitted inline while walking the (already newest-first) rows.
  let lastDay: string | null = null

  return (
    <section
      data-testid="recordings-inbox"
      className="rounded-2xl border border-border bg-card shadow-sm"
    >
      <header className="flex flex-wrap items-center gap-2 px-3.5 pb-2.5 pt-3.5">
        <span className="flex items-center text-muted-foreground">
          <History size={15} aria-hidden="true" />
        </span>
        <span className="text-sm font-semibold text-foreground">{t('title')}</span>
        {needsAttention > 0 && (
          <span className="ml-auto inline-flex h-[21px] items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 text-[11px] font-semibold tabular-nums text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200">
            {t('needsAttention', { n: needsAttention })}
          </span>
        )}
        <span className="w-full text-[11.5px] leading-relaxed text-muted-foreground">
          {t('caption')}
        </span>
        {serverFailed && (
          <span className="w-full text-[11.5px] leading-relaxed text-muted-foreground">
            {t('partial')}
          </span>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="m-0 border-t border-border px-3.5 py-6 text-center text-[13px] text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => {
            const day = dayLabel(row.startedAt)
            const showDay = day !== lastDay
            lastDay = day
            const reason = reasonFor(row)
            return (
              <li key={row.key} className="m-0 p-0">
                {showDay && (
                  <div className="border-y border-border bg-muted/40 px-3.5 pb-1 pt-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground">
                    {day}
                  </div>
                )}
                <div
                  className={`flex flex-col gap-1.5 px-3.5 pb-3 pt-2.5 ${showDay ? '' : 'border-t border-border'}`}
                  data-testid={`inbox-row-${row.key}`}
                  data-state={row.state}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-[42px] shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                      {hmInJst(new Date(row.startedAt))}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">
                      {nameFor(row)}
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                      {row.durationSeconds && row.durationSeconds > 0
                        ? tRec('target.durationMinutes', {
                            n: Math.max(1, Math.round(row.durationSeconds / 60)),
                          })
                        : '—'}
                    </span>
                    <span
                      className={`inline-flex h-[23px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11px] font-semibold ${CHIP_CLASS[row.state]}`}
                    >
                      {row.state === 'saved' && <Check size={10} aria-hidden="true" />}
                      {row.state === 'failed' && <X size={9} aria-hidden="true" />}
                      {row.state === 'processing' && (
                        <i
                          className="size-1.5 shrink-0 rounded-full bg-blue-500 motion-safe:animate-pulse"
                          aria-hidden="true"
                        />
                      )}
                      {t(`state.${STATE_LABEL[row.state]}` as 'state.saved')}
                    </span>
                  </div>

                  {reason && (
                    <p className="m-0 text-[11.5px] leading-relaxed text-muted-foreground">
                      {reason}
                    </p>
                  )}

                  {row.state === 'saved' && row.karuteRecordId && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => onOpenRecord(row)}
                        className="rounded-lg px-1 py-0.5 text-[12.5px] font-semibold text-primary"
                      >
                        {t('action.open')}
                      </button>
                    </div>
                  )}

                  {row.state === 'awaiting-check' && row.karuteRecordId && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => onOpenRecord(row)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-primary bg-primary/8 px-3 text-[12.5px] font-semibold text-primary"
                      >
                        <Eye size={13} aria-hidden="true" />
                        {t('action.check')}
                      </button>
                    </div>
                  )}

                  {row.state === 'failed' && row.canRetry && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => onSaveTake(row)}
                        className="rounded-lg px-1 py-0.5 text-[12.5px] font-semibold text-primary"
                      >
                        {t('action.retry')}
                      </button>
                    </div>
                  )}

                  {row.state === 'recoverable' && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => onSaveTake(row)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground hover:bg-primary-hover"
                      >
                        <Save size={13} aria-hidden="true" />
                        {t('action.save')}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
