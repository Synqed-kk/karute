'use client'

import { useTranslations } from 'next-intl'
import { Sparkles, Info, Shield, Download, RefreshCw, Calendar } from 'lucide-react'
import { SCHEDULES, type ScheduleKey, type ScopeKey } from '@/lib/export/scopes'

interface ExportAdvancedOptionsProps {
  privacy: boolean
  onPrivacyChange: (v: boolean) => void
  schedule: ScheduleKey
  onScheduleChange: (v: ScheduleKey) => void
  scopeKey: ScopeKey
  recipientEmail: string
}

const SCHEDULE_LABEL_KEYS: Record<ScheduleKey, string> = {
  once: 'scheduleOnce',
  weekly: 'scheduleWeekly',
  monthly: 'scheduleMonthly',
}

export function ExportAdvancedOptions({
  privacy,
  onPrivacyChange,
  schedule,
  onScheduleChange,
  scopeKey,
  recipientEmail,
}: ExportAdvancedOptionsProps) {
  const t = useTranslations('dataExport')

  return (
    <section className="rounded-xl border border-border/30 bg-card/50 p-5">
      <div className="mb-3">
        <h3 className="text-[14.5px] font-semibold flex items-center gap-2">
          <Sparkles className="size-3.5 text-muted-foreground" />
          {t('advanced')}
        </h3>
        <div className="text-[12px] text-muted-foreground mt-0.5">
          {t('advancedDescription')}
        </div>
      </div>

      <div className="flex items-start gap-4 py-2.5">
        <button
          type="button"
          onClick={() => onPrivacyChange(!privacy)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors mt-0.5 ${
            privacy ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              privacy ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-medium flex items-center gap-2 flex-wrap">
            {t('redactPii')}
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300/85 bg-amber-500/10 border border-amber-500/25 rounded-full px-1.5 py-0.5">
              {t('redactPiiRecommended')}
            </span>
          </div>
          <div className="text-[12px] text-muted-foreground mt-0.5">
            {t('redactPiiDescription')}
          </div>
        </div>
      </div>

      <div className="border-t border-border/30 my-4" />

      <div className="py-1">
        <div className="text-[13.5px] font-medium mb-2">{t('runSchedule')}</div>
        <div className="inline-flex items-center gap-1 rounded-lg bg-muted/40 p-1">
          {SCHEDULES.map((s) => {
            const Icon =
              s.key === 'once' ? Download : s.key === 'weekly' ? RefreshCw : Calendar
            const active = schedule === s.key
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onScheduleChange(s.key)}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="size-3" />
                {t(SCHEDULE_LABEL_KEYS[s.key])}
              </button>
            )
          })}
        </div>
        {schedule !== 'once' && (
          <div className="mt-3 flex items-start gap-2 text-[12px] text-muted-foreground">
            <Info className="size-3 mt-0.5 text-muted-foreground" />
            <span>
              {schedule === 'weekly'
                ? t('scheduleHintWeekly')
                : t('scheduleHintMonthly')}{' '}
              <span className="font-mono text-foreground">{recipientEmail}</span>
            </span>
          </div>
        )}
      </div>

      {scopeKey === 'karute' && (
        <>
          <div className="border-t border-border/30 my-4" />
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-blue-500/8 border border-blue-500/20">
            <Shield className="size-3.5 text-blue-500 dark:text-blue-300 shrink-0 mt-0.5" />
            <div className="text-[12px] text-blue-700 dark:text-blue-100/85">
              {t('karuteShareWarning')}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
