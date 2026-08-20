'use client'

// PR-B2 — the GREEN notice (mock section 0, boards B0a/B0b).
//
// What the amber RecoveryBanner becomes once the app finishes the save ITSELF
// on relaunch: a statement, not a question. Nothing here is pressable except
// one quiet link to the karute that now exists — no save, no retry, no answer
// to give. If the staffer still owes a decision (the 結果), this says so in one
// line and points at the ONE place it is answered (the karute's OutcomeCard),
// exactly like the banner points at the ONE place a record is landed.
//
// Same honesty rule as the banner it replaces: every money fact is DERIVED
// truth handed down from the server (F7 law) — an absent fact is an OMITTED
// line, never a placeholder and never a guess. 対象外 (no pack) is silence.

import { useTranslations } from 'next-intl'
import { CheckCircle2 } from 'lucide-react'
import type { RecoveryTicketState } from './RecoveryBanner'

export interface RecoveryAutoSavedNoticeProps {
  /** 「山本 結衣様 · 8月18日(月) 14:35 · 52分」 — composed by the caller, which
   *  already owns every one of those formatters for the banner. */
  meta: string
  /** 回数券 truth, RE-DERIVED from server day-facts after the money legs
   *  settled (R-B4). 'none' → the line is omitted entirely. */
  ticketState: RecoveryTicketState
  pack?: { remaining: number; size: number } | null
  /** The 結果 was never answered and never skipped — the save landed without
   *  one (R-B2: the app never invents one). B0b's quiet line. */
  outcomeOwed: boolean
  onOpenKarute: () => void
}

export function RecoveryAutoSavedNotice({
  meta,
  ticketState,
  pack = null,
  outcomeOwed,
  onOpenKarute,
}: RecoveryAutoSavedNoticeProps) {
  const t = useTranslations('recording')

  const lines: string[] = []
  if (ticketState === 'redeemed') {
    // Without the pack numbers the count-free wording is the honest one — the
    // banner degrades the same way rather than inventing a 残N/M.
    lines.push(
      pack
        ? t('recoverAutoTicketBurned', { remaining: pack.remaining, size: pack.size })
        : t('recoverTicketRedeemed'),
    )
  } else if (ticketState === 'unresolved') {
    lines.push(t('recoverAutoTicketUnresolved'))
  }
  if (outcomeOwed) lines.push(t('recoverAutoOutcomeUnanswered'))

  const link = (
    <button
      type="button"
      onClick={onOpenKarute}
      className="ml-auto shrink-0 rounded-lg px-1 py-0.5 text-[13px] font-semibold text-primary"
    >
      {t('recoverAutoOpenKarute')}
    </button>
  )

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 dark:border-green-500/30 dark:bg-green-500/10">
      <div className="flex items-start gap-2 text-[14.5px] font-semibold text-green-800 dark:text-green-200">
        <CheckCircle2
          size={17}
          className="mt-0.5 shrink-0 text-green-700 dark:text-green-300"
          aria-hidden
        />
        <span>{t('recoverAutoSavedTitle')}</span>
      </div>

      <p className="text-[13px] leading-relaxed text-green-700 tabular-nums dark:text-green-300">
        {meta}
      </p>

      {lines.length === 0 ? (
        <div className="flex items-baseline gap-2">{link}</div>
      ) : (
        lines.map((line, i) => (
          <div
            key={line}
            className="flex flex-wrap items-baseline gap-2 text-[12.5px] leading-relaxed text-green-700/90 dark:text-green-300/90"
          >
            <span>{line}</span>
            {i === lines.length - 1 && link}
          </div>
        ))
      )}
    </div>
  )
}
