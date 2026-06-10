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
  /** The customer's active 回数券 (counted pack with sessions left) — shows the
   *  pre-checked 「回数券を消化」 row so redemption happens at the one moment
   *  staff are guaranteed to be in the app (design #1). null/absent → row
   *  hidden, dialog unchanged. */
  pack?: { id: string; remaining: number; size: number } | null
  /** conversion (default) = the trial/first-visit sale question (成約/不成約).
   *  repurchase = the 残2/残1 decision point — 「次の回数券のご案内は？」 with
   *  購入した/案内したが未購入/後で決める. Same Outcome values, different copy —
   *  the coaching labels keep one schema. */
  mode?: 'conversion' | 'repurchase'
  onResolve: (outcome: SessionOutcome, redeemPack: boolean) => void
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
  pack = null,
  mode = 'conversion',
  onResolve,
  onCancel,
}: PostSessionResolutionDialogProps) {
  const t = useTranslations('recording.outcome')
  const [status, setStatus] = useState<Outcome | null>(null)
  const [reason, setReason] = useState<DeclineReason>('considering')
  // Pre-checked: the session just happened, so consuming one pack session is
  // the default truth — unticking is the exception (e.g. a service visit).
  const [redeem, setRedeem] = useState(true)

  // The dialog stays mounted (parent toggles `open`), so a cancelled pick would
  // otherwise survive into the next open and submit a stale outcome. Reset the
  // selection each time it opens.
  useEffect(() => {
    if (open) {
      setStatus(null)
      setReason('considering')
      setRedeem(true)
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
            {mode === 'repurchase'
              ? t('repurchase.title', { name: customerName })
              : t(isFirstVisit ? 'titleFirst' : 'title', { name: customerName })}
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
        <p className="text-sm text-muted-foreground">
          {mode === 'repurchase' ? t('repurchase.subtitle') : t('subtitle')}
        </p>
        {mode === 'conversion' && (
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t('subtitleHint')}
          </p>
        )}

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
                    {mode === 'repurchase'
                      ? t(`repurchase.${KEY[s]}.title`)
                      : t(`${KEY[s]}.title`)}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {mode === 'repurchase'
                      ? t(`repurchase.${KEY[s]}.desc`)
                      : t(`${KEY[s]}.desc`)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {/* 回数券消化 — one tap at the moment staff are guaranteed in the app.
         *  Forgotten redemptions silently corrupt 残回数 (which every 離客 alert
         *  depends on); this makes the check-off part of the existing stop flow. */}
        {pack && pack.remaining > 0 && (
          <div className="mt-4 rounded-xl border border-border p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                {pack.size <= 12 && (
                  <div className="mb-1.5 flex flex-wrap items-center gap-1" aria-hidden>
                    {Array.from({ length: pack.size }, (_, i) => {
                      const consumed = pack.size - pack.remaining
                      const isNext = i === consumed
                      return (
                        <span
                          key={i}
                          className={`size-2 rounded-full ${
                            i < consumed
                              ? 'bg-muted-foreground/30'
                              : isNext && redeem
                                ? 'animate-pulse bg-emerald-500'
                                : 'bg-emerald-500'
                          }`}
                        />
                      )
                    })}
                  </div>
                )}
                <div className="text-[12px] font-medium text-foreground">
                  {t('redeemLabel')}{' '}
                  <span className="font-normal text-muted-foreground tabular-nums">
                    {t('redeemDelta', {
                      from: pack.remaining,
                      to: redeem ? pack.remaining - 1 : pack.remaining,
                    })}
                  </span>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={redeem}
                aria-label={t('redeemLabel')}
                onClick={() => setRedeem((v) => !v)}
                className={`relative h-[26px] w-11 shrink-0 rounded-full transition-colors ${
                  redeem ? 'bg-emerald-600' : 'bg-muted-foreground/30'
                }`}
              >
                <span
                  className={`absolute top-[3px] size-5 rounded-full bg-white transition-all ${
                    redeem ? 'right-[3px]' : 'left-[3px]'
                  }`}
                />
              </button>
            </div>
            {pack.remaining === 1 && redeem && (
              <p className="mt-2.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                {t('redeemZeroHint')}
              </p>
            )}
          </div>
        )}

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
              onResolve(
                {
                  status,
                  reason: status === 'no_deal' ? reason : null,
                  isFirstVisit,
                },
                !!pack && pack.remaining > 0 && redeem,
              )
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
