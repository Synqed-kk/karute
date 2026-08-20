'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Clock, RotateCw, X } from 'lucide-react'
import {
  DECLINE_REASONS,
  type DeclineReason,
  type Outcome,
  type SessionOutcome,
} from '@/lib/karute/outcome-types'
import type { PackPreset } from '@/actions/org-settings'

/** The 新しい回数券 the staff registered in the dialog (null = あとで登録). */
export interface NewPackInput {
  size: number
  unitPrice: number
}

interface PostSessionResolutionDialogProps {
  open: boolean
  customerName: string
  isFirstVisit: boolean
  /** Server-derived returning-customer signal for THIS session's customer —
   *  gates the 4th 「既存のお客様」 card. Deliberately separate from
   *  `isFirstVisit` (which defaults `false` at its call site and is written to
   *  the outcome row): `null`/absent = UNKNOWN, and unknown must never show the
   *  card speculatively (plan L2#4). Only `true` opens it. */
  isReturningCustomer?: boolean | null
  saving?: boolean
  /** The customer's active 回数券 (counted pack with sessions left) — shows the
   *  pre-checked 「回数券を消化」 row so redemption happens at the one moment
   *  staff are guaranteed to be in the app (design #1). null/absent → row
   *  hidden, dialog unchanged. */
  pack?: { id: string; remaining: number; size: number } | null
  /** R-B6 ⑥ — this session's BOOKING already carries a live redemption (server-
   *  derived; the storage layer would refuse a second one anyway). The dialog
   *  then STATES 消化済み instead of offering the burn again, and asks only the
   *  non-money questions. Absent/false → today's behavior, toggle and all
   *  (its pre-ON default is Liam-ruled ⚖ 8/21 ③ and untouched here). */
  alreadyRedeemed?: boolean
  /** conversion (default) = the trial/first-visit sale question (成約/不成約).
   *  repurchase = the 残2/残1 decision point — 「次の回数券のご案内は？」 with
   *  購入した/案内したが未購入/後で決める. Same Outcome values, different copy —
   *  the coaching labels keep one schema. */
  mode?: 'conversion' | 'repurchase'
  /** Owner-managed size/price chips for the 新しい回数券 panel (設定 → 回数券). */
  packPresets?: PackPreset[]
  /** Off → no free size/price input; staff pick from presets only. */
  staffCanCustomize?: boolean
  /** The customer's most recent pack — the prefill beats presets. */
  previousPack?: { size: number; unitPrice: number } | null
  onResolve: (
    outcome: SessionOutcome,
    redeemPack: boolean,
    newPack: NewPackInput | null,
  ) => void
  onCancel: () => void
}

const TONE: Record<Outcome, { ring: string; bg: string; icon: string }> = {
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
  // Amber wash (Liam-approved mock 8/10) — a regular visit is neither a win
  // (green) nor a loss (red). Semantic tone, not the interactive accent.
  revisit: {
    ring: 'ring-amber-300 bg-amber-50 dark:bg-amber-500/10',
    bg: 'bg-amber-200 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    icon: 'text-amber-700 dark:text-amber-300',
  },
}

export function PostSessionResolutionDialog({
  open,
  customerName,
  isFirstVisit,
  isReturningCustomer = null,
  saving = false,
  pack = null,
  alreadyRedeemed = false,
  mode = 'conversion',
  packPresets = [],
  staffCanCustomize = true,
  previousPack = null,
  onResolve,
  onCancel,
}: PostSessionResolutionDialogProps) {
  const t = useTranslations('recording.outcome')
  const [status, setStatus] = useState<Outcome | null>(null)
  const [reason, setReason] = useState<DeclineReason>('considering')
  // Pre-checked: the session just happened, so consuming one pack session is
  // the default truth — unticking is the exception (e.g. a service visit).
  const [redeem, setRedeem] = useState(true)
  // 新しい回数券 panel (opens on 成約/購入した) — the count-from-N starts HERE,
  // at the moment the sale happens, never as a separate profile errand.
  // Prefill: the customer's previous pack beats the first preset.
  const prefill = previousPack ?? packPresets[0] ?? null
  const [later, setLater] = useState(false)
  const [npSize, setNpSize] = useState<number>(prefill?.size ?? 0)
  const [npPrice, setNpPrice] = useState<number>(prefill?.unitPrice ?? 0)
  const [sizeCustom, setSizeCustom] = useState(false)
  const [priceCustom, setPriceCustom] = useState(false)

  // The dialog stays mounted (parent toggles `open`), so a cancelled pick would
  // otherwise survive into the next open and submit a stale outcome. Reset the
  // selection each time it opens.
  useEffect(() => {
    if (open) {
      setStatus(null)
      setReason('considering')
      setRedeem(true)
      setLater(false)
      setNpSize(prefill?.size ?? 0)
      setNpPrice(prefill?.unitPrice ?? 0)
      setSizeCustom(false)
      setPriceCustom(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const ICON: Record<Outcome, React.ReactNode> = {
    success: <Check size={16} />,
    no_deal: <X size={16} />,
    pending: <Clock size={16} />,
    revisit: <RotateCw size={16} />,
  }
  const KEY: Record<Outcome, 'success' | 'noDeal' | 'pending' | 'revisit'> = {
    success: 'success',
    no_deal: 'noDeal',
    pending: 'pending',
    revisit: 'revisit',
  }
  // Card order per the approved mock: 成約 → 既存のお客様 → 不成約 → 後で決める.
  // repurchase mode keeps its own 3-option set — the customer is mid-pack by
  // definition there, so a "regular visit" answer would be meaningless.
  const options: Outcome[] =
    mode === 'conversion' && isReturningCustomer === true
      ? ['success', 'revisit', 'no_deal', 'pending']
      : ['success', 'no_deal', 'pending']
  // A pick can only ever be one the dialog is currently OFFERING. Today the
  // open-reset makes this unreachable; it stops a future options change from
  // silently saving a status whose card is no longer on screen.
  const effectiveStatus = status && options.includes(status) ? status : null

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
            disabled={saving}
            aria-label={t('cancel')}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
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
          {options.map((s) => {
            const selected = effectiveStatus === s
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
                  {/* Guard against lazy mislabeling: revisit has no reason
                   *  chips to slow staff down, so the card itself carries the
                   *  「断られたら不成約」 rule (plan D5 / L2#3). */}
                  {s === 'revisit' && (
                    <span className="mt-0.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                      {t('revisit.guard')}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>

        {/* 回数券消化 — one tap at the moment staff are guaranteed in the app.
         *  Forgotten redemptions silently corrupt 残回数 (which every 離客 alert
         *  depends on); this makes the check-off part of the existing stop flow. */}
        {/* R-B6: one booking = max one burn. The ticket already moved for this
         *  visit, so there is nothing to decide — state it and move on. */}
        {pack && alreadyRedeemed && (
          <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3.5">
            <p className="text-[12px] font-medium text-foreground">
              {t('redeemAlready', { remaining: pack.remaining, size: pack.size })}
            </p>
          </div>
        )}

        {pack && !alreadyRedeemed && pack.remaining > 0 && (
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

        {(() => {
          if (effectiveStatus !== 'success') return null
          const sizeOptions = [...new Set([
            ...(previousPack ? [previousPack.size] : []),
            ...packPresets.map((p) => p.size),
          ])].sort((a, b) => a - b)
          const priceOptions = [...new Set([
            ...(previousPack ? [previousPack.unitPrice] : []),
            ...packPresets.map((p) => p.unitPrice),
          ])].sort((a, b) => a - b)
          // No presets AND no custom input allowed → nothing to pick; skip the
          // panel entirely (falls back to the あとで登録 toast path).
          if (!staffCanCustomize && sizeOptions.length === 0) return null
          const valid = npSize > 0 && npPrice > 0
          return (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 dark:border-emerald-500/30 dark:bg-emerald-500/5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] font-semibold text-emerald-800 dark:text-emerald-300">
                  {t('newPack.title')}
                </span>
                <button
                  type="button"
                  onClick={() => setLater((v) => !v)}
                  className={`rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                    later
                      ? 'font-semibold text-foreground underline underline-offset-2'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('newPack.later')}
                </button>
              </div>
              {!later && (
                <>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {t('newPack.sizeLabel')}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {sizeOptions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => { setNpSize(s); setSizeCustom(false) }}
                        className={`rounded-lg border px-3.5 py-1.5 text-xs tabular-nums transition-colors ${
                          npSize === s && !sizeCustom
                            ? 'border-emerald-500 bg-white font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
                            : 'border-border text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {t('newPack.sizeChip', { n: s })}
                      </button>
                    ))}
                    {staffCanCustomize && (
                      sizeCustom ? (
                        <input
                          type="number"
                          min={1}
                          max={100}
                          autoFocus
                          value={npSize || ''}
                          onChange={(e) => setNpSize(Number(e.target.value))}
                          className="w-20 rounded-lg border border-emerald-500 bg-transparent px-2 py-1.5 text-xs tabular-nums text-foreground outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setSizeCustom(true); setNpSize(0) }}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                        >
                          {t('newPack.customSize')}
                        </button>
                      )
                    )}
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    {t('newPack.priceLabel')}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {priceOptions.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => { setNpPrice(p); setPriceCustom(false) }}
                        className={`rounded-lg border px-3.5 py-1.5 text-xs tabular-nums transition-colors ${
                          npPrice === p && !priceCustom
                            ? 'border-emerald-500 bg-white font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200'
                            : 'border-border text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        ¥{p.toLocaleString('ja-JP')}
                      </button>
                    ))}
                    {staffCanCustomize && (
                      priceCustom ? (
                        <input
                          type="number"
                          min={0}
                          step={100}
                          autoFocus
                          value={npPrice || ''}
                          onChange={(e) => setNpPrice(Number(e.target.value))}
                          className="w-28 rounded-lg border border-emerald-500 bg-transparent px-2 py-1.5 text-xs tabular-nums text-foreground outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setPriceCustom(true); setNpPrice(0) }}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                        >
                          {t('newPack.customPrice')}
                        </button>
                      )
                    )}
                  </div>
                  <div className="mt-2.5 flex items-baseline justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      {!valid && t('newPack.invalidHint')}
                    </span>
                    {valid && (
                      <span className="text-[12px] font-semibold tabular-nums text-emerald-800 dark:text-emerald-300">
                        {npSize}回 × ¥{npPrice.toLocaleString('ja-JP')} = ¥
                        {(npSize * npPrice).toLocaleString('ja-JP')}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })()}

        {effectiveStatus === 'no_deal' && (
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
                      ? 'border-primary bg-primary/8 text-primary'
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
            disabled={
              effectiveStatus === null ||
              saving ||
              // 成約 with the pack panel open requires a valid size+price (or
              // an explicit あとで登録) — never a silent half-registered sale.
              (effectiveStatus === 'success' &&
                !later &&
                (staffCanCustomize || packPresets.length > 0) &&
                !(npSize > 0 && npPrice > 0))
            }
            onClick={() =>
              effectiveStatus &&
              onResolve(
                {
                  status: effectiveStatus,
                  reason: effectiveStatus === 'no_deal' ? reason : null,
                  isFirstVisit,
                },
                // alreadyRedeemed → never a second burn, whatever the toggle
                // last held (it isn't even on screen).
                !alreadyRedeemed && !!pack && pack.remaining > 0 && redeem,
                effectiveStatus === 'success' && !later && npSize > 0 && npPrice > 0
                  ? { size: npSize, unitPrice: npPrice }
                  : null,
              )
            }
            className="inline-flex h-11 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40"
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
