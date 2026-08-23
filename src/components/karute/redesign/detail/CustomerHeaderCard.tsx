'use client'

import type { ReactNode } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Calendar, ChevronRight, Clipboard, Edit3, Heart, Mail, Phone, User } from 'lucide-react'
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

// ⚖ 2026-09-03 (PACKET-CARD-CLONE): exact structural clone of the customer
// page's real header — src/components/customers/redesign/profile/
// CustomerIdentityCard.tsx (pinned e1a3f326). Three swaps only: edit pencil
// -> the `actions` slot (⇆ reassign, same top-right position), no mic
// button (no karute-side recording jump from this card), 登録 -> 施術日.
// Chrome is FLAT — bg-card + one bottom hairline, no card box (matches the
// customer page's real header, not the old bordered/rounded 案D card).
function Meta({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground/70">{icon}</span>
      <span>{children}</span>
    </span>
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
  // Cross-namespace reuse of the customer page's own age/visit-count keys
  // (B-4, ⚖ sanctioned — both keys already ship live on the customer
  // profile page, cite clone precedent).
  const tProfile = useTranslations('customers.profile')
  const ja = useLocale() === 'ja'

  const ageText = age != null ? tProfile('ageValue', { age }) : null
  // Branch's own separator convention survives (B-4): full-width ・ in ja,
  // spaced middle-dot in en.
  const ageGenderText =
    ageText && gender ? `${ageText}${ja ? '・' : ' · '}${gender}` : ageText || gender || null
  const hasVisitCount = visitNumber != null && visitNumber > 0

  const hasMetaRow = Boolean(ageGenderText || hasVisitCount || lastVisitDate || sessionDateLong)
  const hasContactRow = Boolean(phone || email)
  const hasStaffRow = Boolean(staffName || service)

  return (
    <section className="relative border-b border-black/5 bg-card px-4 pb-4 pt-4 dark:border-white/5 md:px-6 md:pb-5 md:pt-6">
      <div className="flex items-start gap-3 md:gap-4">
        {/* Avatar — size-11 mobile / size-14 desktop, clone's bg-muted ring
            (no blue, no dark: variants — the clone avatar is neutral). */}
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-[15px] font-semibold text-foreground ring-1 ring-black/5 md:h-14 md:w-14 md:text-lg">
          {initials}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Always an <h2> so the heading survives in both branches (a11y);
              the Link sits INSIDE it when a customer profile exists. */}
          <div className="flex flex-wrap items-baseline gap-1.5">
            <h2 className="min-w-0 text-[22px] font-semibold leading-tight tracking-tight text-foreground md:text-2xl">
              {customerHref ? (
                <Link
                  href={customerHref as Parameters<typeof Link>[0]['href']}
                  className="group inline-flex min-w-0 max-w-full items-center gap-1 transition-colors hover:text-sky-600"
                  aria-label={`${customerName} — ${t('header.openCustomer')}`}
                  title={t('header.openCustomer')}
                >
                  <span className="min-w-0 truncate">{customerName}</span>
                  <ChevronRight
                    size={14}
                    className="shrink-0 text-muted-foreground transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-sky-600"
                  />
                </Link>
              ) : (
                <span className="block truncate">{customerName}</span>
              )}
            </h2>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{karuteNumber}</span>
          </div>

          {/* Meta — age/gender + visit count + last visit + 施術日 (the
              clone's 登録 slot, repurposed). One flex-wrap row, density
              rule: everything that fits shares the row. */}
          {hasMetaRow && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {ageGenderText && (
                <Meta icon={<User size={12} />}>
                  <span className="tabular-nums">{ageGenderText}</span>
                </Meta>
              )}
              {hasVisitCount && (
                <Meta icon={<Clipboard size={12} />}>
                  <span className="tabular-nums">{visitNumber}</span>
                  <span>{tProfile('visitCountSuffix')}</span>
                </Meta>
              )}
              {lastVisitDate && (
                <Meta icon={<Heart size={12} />}>
                  <span className="text-muted-foreground/70">{t('header.lastVisit')}</span>{' '}
                  <span className="tabular-nums">{lastVisitDate}</span>
                  {lastVisitAgo && <span className="text-muted-foreground/70"> {lastVisitAgo}</span>}
                </Meta>
              )}
              {sessionDateLong && (
                <Meta icon={<Calendar size={12} />}>
                  {t('header.sessionDate')} <span className="tabular-nums">{sessionDateLong}</span>
                </Meta>
              )}
            </div>
          )}

          {/* Contact — phone + email, tel:/mailto: links (clone behavior:
              both render as links when a value exists; B-3 carve-out drops
              the clone's `—` fallback — an absent value collapses, no
              orphan). */}
          {hasContactRow && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {phone && (
                <Meta icon={<Phone size={12} />}>
                  <a
                    href={`tel:${phone}`}
                    className="tabular-nums text-blue-600 underline decoration-blue-600/40 underline-offset-2 transition-transform active:scale-95 dark:text-blue-400"
                  >
                    {phone}
                  </a>
                </Meta>
              )}
              {email && (
                <Meta icon={<Mail size={12} />}>
                  <a
                    href={`mailto:${email}`}
                    className="text-blue-600 underline decoration-blue-600/40 underline-offset-2 dark:text-blue-400"
                  >
                    {email}
                  </a>
                </Meta>
              )}
            </div>
          )}

          {/* 担当 (staff line, clone's text-[11px] treatment) + メニュー —
              service is production-dead (prop frozen); render support kept
              as a plain unlabeled item per B-7. */}
          {hasStaffRow && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              {staffName && (
                <span>
                  {t('header.staff')} <span className="text-foreground">{staffName}</span>
                </span>
              )}
              {service && <span>{service}</span>}
            </div>
          )}
        </div>

        {/* Top-right action slot — the clone's pencil position. onEdit stays
            in the tail group when passed (frozen prop). */}
        {(onEdit || actions) && (
          <div className="ml-auto flex flex-none items-center gap-1.5 self-start">
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
    </section>
  )
}
