'use client'

import { useTranslations } from 'next-intl'
import { Edit3, Mail, Phone } from 'lucide-react'

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
  /** Optional click handler for the Edit button. */
  onEdit?: () => void
}

function ordinal(n: number, locale: 'en' | 'ja' = 'en'): string {
  if (locale === 'ja') return `${n}回目`
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
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
  onEdit,
}: CustomerHeaderProps) {
  const t = useTranslations('karuteDetail')
  const metaParts: React.ReactNode[] = []
  if (age != null) metaParts.push(<span key="age">{age}</span>)
  if (gender) metaParts.push(<span key="gender">{gender}</span>)
  if (visitNumber != null && visitNumber > 0)
    metaParts.push(<span key="vn">{ordinal(visitNumber)} visit</span>)
  if (lastVisitDate)
    metaParts.push(<span key="lvd">{lastVisitDate}</span>)
  if (lastVisitAgo)
    metaParts.push(<span key="lva">{lastVisitAgo}</span>)

  return (
    <section className="flex items-start gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm md:gap-6 md:p-6">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-base font-bold text-foreground md:h-16 md:w-16 md:text-lg">
        {initials}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            {customerName}
          </h2>
          <span className="text-sm font-medium text-muted-foreground tabular-nums">
            {karuteNumber}
          </span>
        </div>
        {metaParts.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
            {metaParts.map((part, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 && (
                  <span aria-hidden className="text-muted-foreground">
                    ·
                  </span>
                )}
                {part}
              </span>
            ))}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
          {service && (
            <>
              <span className="font-medium text-foreground">{service}</span>
              <span aria-hidden className="text-muted-foreground">·</span>
            </>
          )}
          <span className="text-muted-foreground">{sessionDateLong}</span>
          {staffName && (
            <>
              <span aria-hidden className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                {t('header.staff')}{' '}
                <span className="text-foreground">{staffName}</span>
              </span>
            </>
          )}
        </div>
        {(phone || email) && (
          <div className="mt-1 flex flex-wrap items-center gap-4 text-[13px] text-muted-foreground">
            {phone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone size={13} className="opacity-70" />
                <span className="tabular-nums">{phone}</span>
              </span>
            )}
            {email && (
              <span className="inline-flex items-center gap-1.5">
                <Mail size={13} className="opacity-70" />
                <span>{email}</span>
              </span>
            )}
          </div>
        )}
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
        >
          <Edit3 size={13} />
          <span>{t('actions.edit')}</span>
        </button>
      )}
    </section>
  )
}
