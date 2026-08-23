'use client'

import type { ReactNode } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Edit3, ChevronRight } from 'lucide-react'
import { Link } from '@/i18n/navigation'

export interface CustomerHeaderProps {
  customerName: string
  initials: string
  karuteNumber: string
  service: string | null
  sessionDateLong: string
  staffName: string | null
  phone: string | null
  email: string | null
  /** Extras — render only when populated. */
  age?: number | null
  gender?: string | null
  visitNumber?: number | null
  lastVisitDate?: string | null
  lastVisitAgo?: string | null
  /** When set, the customer name becomes a tappable link to the customer
   *  profile (the strong affordance to jump from a session to the person). */
  customerHref?: string
  /** Optional click handler for the Edit button. */
  onEdit?: () => void
  /** F4 (fix round 1, F-2; repositioned fix round 8 — R8-1): trailing-inline
   *  in the TITLE row (top-right corner, level with the name), never its own
   *  full-width row — a lone small icon in a dedicated row read as dead
   *  space (Liam's screenshots, 8/23). Renders nothing when absent, so every
   *  other caller of this card is visually unchanged. */
  actions?: ReactNode
}

// 案D (Liam ruling): two-band card — band 1 is identity, band 2 is labeled
// session facts. Each fact column renders ONLY when its value exists; an
// absent column disappears entirely (no dash, no orphan label) and the
// remaining columns fill the row. Order below is the ruled order.
const FACT_LABEL_CLS =
  'text-[10.5px] font-semibold leading-[13px] tracking-[0.05em] text-muted-foreground/70'
const FACT_VALUE_CLS =
  'mt-0.5 truncate text-sm font-semibold leading-[18px] text-foreground max-sm:text-[13.5px]'
const FACT_VALUE_LIGHT_CLS =
  'mt-0.5 truncate text-sm font-medium leading-[18px] text-foreground max-sm:text-[13.5px]'

function Fact({
  label,
  value,
  className = 'min-w-0',
  valueClassName = FACT_VALUE_CLS,
}: {
  label: string
  value: ReactNode
  className?: string
  valueClassName?: string
}) {
  return (
    <div className={className}>
      <div className={FACT_LABEL_CLS}>{label}</div>
      <div className={valueClassName}>{value}</div>
    </div>
  )
}

export function CustomerHeaderCard({
  customerName,
  initials,
  karuteNumber,
  service,
  sessionDateLong,
  staffName,
  phone,
  email,
  age,
  gender,
  visitNumber,
  lastVisitDate,
  lastVisitAgo,
  customerHref,
  onEdit,
  actions,
}: CustomerHeaderProps) {
  const t = useTranslations('karuteDetail')
  const ja = useLocale() === 'ja'

  const ageText = age != null ? (ja ? `${age}歳` : `${age}`) : null
  const ageGenderText =
    ageText && gender ? `${ageText}${ja ? '・' : ' · '}${gender}` : ageText || gender || null

  const facts: ReactNode[] = []
  if (sessionDateLong) {
    facts.push(<Fact key="sessionDate" label={t('header.sessionDate')} value={sessionDateLong} />)
  }
  if (visitNumber != null && visitNumber > 0) {
    facts.push(
      <Fact
        key="visitCount"
        label={t('header.visitCount')}
        value={ja ? `${visitNumber}回目` : visitNumber}
      />,
    )
  }
  if (lastVisitDate) {
    facts.push(
      <Fact
        key="lastVisit"
        label={t('header.lastVisit')}
        value={
          <>
            {lastVisitDate}
            {lastVisitAgo && (
              <span className="font-normal text-muted-foreground"> {lastVisitAgo}</span>
            )}
          </>
        }
      />,
    )
  }
  if (service) {
    facts.push(<Fact key="menu" label={t('header.menu')} value={service} />)
  }
  if (staffName) {
    facts.push(<Fact key="staff" label={t('header.staff')} value={staffName} />)
  }
  if (phone) {
    facts.push(<Fact key="phone" label={t('header.phone')} value={phone} />)
  }
  if (email) {
    facts.push(
      <Fact
        key="email"
        label={t('header.email')}
        value={email}
        className="min-w-0 flex-[1_1_160px] max-sm:flex-[1_1_100%]"
        valueClassName={FACT_VALUE_LIGHT_CLS}
      />,
    )
  }

  return (
    <section className="flex flex-col gap-1.5 rounded-[14px] border border-border bg-card px-4 py-1.5 shadow-sm tabular-nums">
      <div className="flex min-h-[44px] items-center gap-2">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-blue-200 bg-blue-100 text-[15px] font-bold text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/15 dark:text-blue-300">
          {initials}
        </div>
        {/* Always an <h2> so the heading survives in both branches (a11y);
            the Link sits INSIDE it when a customer profile exists. */}
        <h2 className="min-w-0 text-base font-semibold text-foreground">
          {customerHref ? (
            <Link
              href={customerHref as Parameters<typeof Link>[0]['href']}
              className="group inline-flex min-w-0 max-w-full items-center gap-1 transition-colors hover:text-sky-600"
              aria-label={`${customerName} — ${t('header.openCustomer')}`}
              title={t('header.openCustomer')}
            >
              <span className="min-w-0 truncate">{customerName}</span>
              <ChevronRight
                size={16}
                className="shrink-0 text-muted-foreground transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-sky-600"
              />
            </Link>
          ) : (
            <span className="block truncate">{customerName}</span>
          )}
        </h2>
        <span className="flex-none rounded-[5px] border border-border bg-muted px-1.5 py-px font-mono text-[11px] font-semibold text-muted-foreground">
          {karuteNumber}
        </span>
        {ageGenderText && (
          <span className="flex-none text-[12.5px] text-muted-foreground">{ageGenderText}</span>
        )}
        {(onEdit || actions) && (
          <div className="ml-auto flex flex-none items-center gap-1.5">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
              >
                <Edit3 size={13} />
                <span>{t('actions.edit')}</span>
              </button>
            )}
            {actions}
          </div>
        )}
      </div>
      {facts.length > 0 && (
        <div className="-mx-4 flex flex-wrap gap-x-[22px] gap-y-1.5 border-t border-border px-4 pt-1.5">
          {facts}
        </div>
      )}
    </section>
  )
}
