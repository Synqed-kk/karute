'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Clock, X } from 'lucide-react'
import {
  DECLINE_REASONS,
  type DeclineReason,
  type Outcome,
  type SessionOutcome,
} from '@/lib/karute/outcome-types'

interface PostSessionResolutionDialogProps {
  open: boolean
  customerName: string
  isFirstVisit: boolean
  saving?: boolean
  onResolve: (outcome: SessionOutcome) => void
  onCancel: () => void
}

const TONE: Record<
  'success' | 'no_deal' | 'pending',
  { ring: string; bg: string; icon: string }
> = {
  success: {
    ring: 'ring-green-500/40 bg-green-50/60 dark:bg-green-500/10',
    bg: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
    icon: 'text-green-600 dark:text-green-300',
  },
  no_deal: {
    ring: 'ring-red-500/40 bg-red-50/60 dark:bg-red-500/10',
    bg: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
    icon: 'text-red-600 dark:text-red-300',
  },
  pending: {
    ring: 'ring-border bg-muted/40',
    bg: 'bg-muted text-muted-foreground',
    icon: 'text-muted-foreground',
  },
}

export function PostSessionResolutionDialog({
  open,
  customerName,
  isFirstVisit,
  saving = false,
  onResolve,
  onCancel,
}: PostSessionResolutionDialogProps) {
  const t = useTranslations('recording.outcome')
  const [status, setStatus] = useState<Outcome | null>(null)
  const [reason, setReason] = useState<DeclineReason>('considering')

  // The dialog stays mounted (parent toggles `open`), so a cancelled pick would
  // otherwise survive into the next open and submit a stale outcome. Reset the
  // selection each time it opens.
  useEffect(() => {
    if (open) {
      setStatus(null)
      setReason('considering')
    }
  }, [open])

  if (!open) return null

  const ICON: Record<Outcome, React.ReactNode> = {
    success: <Check size={16} />,
    no_deal: <X size={16} />,
    pending: <Clock size={16} />,
  }
  const KEY: Record<Outcome, 'success' | 'noDeal' | 'pending'> = {
    success: 'success',
    no_deal: 'noDeal',
    pending: 'pending',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label={t('cancel')}
        onClick={onCancel}
        disabled={saving}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl md:p-6">
        <header className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {t(isFirstVisit ? 'titleFirst' : 'title', { name: customerName })}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('cancel')}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X size={18} />
          </button>
        </header>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {t('subtitleHint')}
        </p>

        <div className="mt-4 space-y-2.5">
          {(['success', 'no_deal', 'pending'] as Outcome[]).map((s) => {
            const selected = status === s
            const tone = TONE[s]
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`flex w-full items-start gap-3 rounded-xl border border-border p-3.5 text-left transition-colors ${
                  selected ? `ring-2 ${tone.ring}` : 'hover:bg-muted/40'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tone.bg}`}
                >
                  {ICON[s]}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground">
                    {t(`${KEY[s]}.title`)}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {t(`${KEY[s]}.desc`)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {status === 'no_deal' && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {t('reasonLabel')}
            </p>
            <div className="flex flex-wrap gap-2">
              {DECLINE_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    reason === r
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t(`reason.${r}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2.5 text-[11px] leading-relaxed text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
          {t('disclaimer')}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            disabled={status === null || saving}
            onClick={() =>
              status &&
              onResolve({
                status,
                reason: status === 'no_deal' ? reason : null,
                isFirstVisit,
              })
            }
            className="inline-flex h-11 items-center justify-center rounded-xl bg-foreground text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? t('saving') : t('save')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
