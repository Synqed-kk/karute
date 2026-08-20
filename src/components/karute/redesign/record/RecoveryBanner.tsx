'use client'

// ONE recovery banner (PR-B1 D1) — replaces the two amber strips the record
// page used to carry (draft-recover + take-recover). Both were a title and two
// buttons; the field lesson (⚖ 8/20) is that neither told the staffer WHOSE
// recording it was, and one of the two buttons destroyed it.
//
// So: the amber card shape stays, the contents become the facts a staffer needs
// to trust the save (customer · when · how long · who recorded · menu · 回数券),
// and there is exactly ONE action — 保存する. No 破棄, no ✕. A recording that
// reached this banner is a SYSTEM failure; the staff's only job is to land it.
//
// Everything money-shaped here is DERIVED truth handed down from the server
// (F7 law) — this component computes no balances and guesses no state. An
// absent fact is an omitted line, never a placeholder.

import { useTranslations } from 'next-intl'
import { AlertTriangle, Save, UserRound } from 'lucide-react'

export type RecoveryTicketState = 'redeemed' | 'unresolved' | 'none'

export interface RecoveryBannerProps {
  /** null = the take never got a customer (walk-in interrupted before the
   *  pick). The action then reads お客様を選んで保存する and opens the picker. */
  customerName: string | null
  /** 「8月18日(月) 14:22」, pre-formatted JST. */
  recordedAt: string
  /** 「8月18日(月)」 — the recording DAY alone, for the unbound caption (the
   *  picker will only offer that day's bookings, so the banner says so). */
  dayLabel: string
  /** 「23分」, or null when the length can't be derived honestly. */
  lengthLabel: string | null
  /** Signed-in staff display name — the take is owner-scoped by construction
   *  (take-store's owner gate), so this IS the recorder. */
  recordedBy: string | null
  /** The booking's menu, from the take's bind-time display snapshot. Absent
   *  for a walk-in — never guessed from the schedule. */
  service?: string | null
  /**
   * 回数券 line. 'redeemed' = a live redemption already exists for this visit
   * (the answer survived the crash, or the cron settled it) · 'unresolved' =
   * the customer holds a pack and nothing burned · 'none' = no pack, or the
   * truth is unknown → the line is omitted entirely (calm default).
   */
  ticketState: RecoveryTicketState
  /** Remaining/size for the 回数券 line. Null → the line degrades to its
   *  count-free wording rather than inventing a number. */
  pack?: { remaining: number; size: number } | null
  /** Bound case only: the 保存先 row + its 変更 link. */
  onRepoint?: () => void
  onSave: () => void
  saving?: boolean
}

export function RecoveryBanner({
  customerName,
  recordedAt,
  dayLabel,
  lengthLabel,
  recordedBy,
  service,
  ticketState,
  pack = null,
  onRepoint,
  onSave,
  saving = false,
}: RecoveryBannerProps) {
  const t = useTranslations('recording')

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="mb-2.5 flex items-start gap-2 font-semibold text-amber-900 dark:text-amber-200">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
        <span>{t('recoverBannerTitle')}</span>
      </div>

      <dl className="flex flex-col gap-0.5 text-[13px] text-amber-900 dark:text-amber-200">
        <Row label={t('recoverFieldCustomer')} muted={!customerName}>
          {customerName ?? t('recoverCustomerUnset')}
        </Row>
        <Row label={t('recoverFieldRecordedAt')} tnum>
          {recordedAt}
        </Row>
        {lengthLabel && (
          <Row label={t('recoverFieldLength')} tnum>
            {lengthLabel}
          </Row>
        )}
        {recordedBy && <Row label={t('recoverFieldRecordedBy')}>{recordedBy}</Row>}
        {service && <Row label={t('recoverFieldService')}>{service}</Row>}
        {ticketState !== 'none' && (
          <Row label={t('recoverFieldTicket')} muted={ticketState === 'unresolved'}>
            {ticketState === 'redeemed'
              ? pack
                ? t('recoverTicketRedeemedCount', {
                    remaining: pack.remaining,
                    size: pack.size,
                  })
                : t('recoverTicketRedeemed')
              : t('recoverTicketUnresolved')}
          </Row>
        )}
      </dl>

      {/* 保存先 + 変更 — bound case only. A take with no customer has no
          destination to show yet; its ONE button opens the picker instead. */}
      {customerName && onRepoint && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-white/70 px-3 py-2 shadow-[0_0_0_1px] shadow-amber-200 dark:bg-white/5 dark:shadow-amber-500/30">
          <span className="text-[11.5px] text-amber-800 dark:text-amber-300/90">
            {t('recoverDestination')}
          </span>
          <span className="text-[13.5px] font-semibold text-amber-900 dark:text-amber-200">
            {customerName}
          </span>
          <button
            type="button"
            onClick={onRepoint}
            disabled={saving}
            className="ml-auto rounded-lg px-1 py-0.5 text-[12.5px] font-semibold text-primary underline underline-offset-2 disabled:opacity-50"
          >
            {t('recoverRepoint')}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {customerName ? <Save size={17} aria-hidden /> : <UserRound size={17} aria-hidden />}
        {customerName ? t('recoverSaveAction') : t('recoverPickAndSaveAction')}
      </button>

      <p className="mt-2 px-0.5 text-[11.5px] leading-relaxed text-amber-800 dark:text-amber-300/90">
        {customerName ? t('recoverCaption') : t('recoverCaptionUnbound', { date: dayLabel })}
      </p>
    </div>
  )
}

function Row({
  label,
  children,
  muted = false,
  tnum = false,
}: {
  label: string
  children: React.ReactNode
  muted?: boolean
  tnum?: boolean
}) {
  return (
    <div className="flex gap-2 leading-relaxed">
      <dt className="w-[4.5rem] shrink-0 text-amber-800/85 dark:text-amber-300/80">{label}</dt>
      <dd
        className={`${muted ? 'font-medium opacity-90' : 'font-semibold'} ${
          tnum ? 'tabular-nums' : ''
        }`}
      >
        {children}
      </dd>
    </div>
  )
}
