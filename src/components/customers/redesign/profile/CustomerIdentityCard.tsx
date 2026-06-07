'use client'

// LIFTED FROM SPIKE (structure: matches spike's CustomerHeaderCard.tsx)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute/CustomerHeaderCard.tsx
//
// Flat section (no card chrome) — bg-card + border-b only, edge-to-edge
// on mobile + desktop. Meta row shows: age · gender · visit count ·
// last visit · usual course · joined date — the at-a-glance facts
// staff scans before a session.

import {
  Briefcase,
  Cake,
  Calendar,
  Clipboard,
  Heart,
  Mail,
  Mic,
  Phone,
  Sparkles,
  Ticket,
  User,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { CustomerProfileData } from '../types'
import { STATUS_STYLES } from '../types'
import { ComingSoonChip } from '../ComingSoonChip'
import { CustomerEditDialog } from './CustomerEditDialog'

interface CustomerIdentityCardProps {
  c: CustomerProfileData
}

export function CustomerIdentityCard({ c }: CustomerIdentityCardProps) {
  const t = useTranslations('customers.list')
  const tProfile = useTranslations('customers.profile')
  const status = STATUS_STYLES[c.status]
  return (
    // Owns its own px-4 md:px-6 (matches spike's CustomerHeaderCard).
    // The (app) layout now provides ZERO horizontal padding (system-
    // wide rule), so the identity section's own px is what positions
    // its content at 16/24px from screen edge. On the karute customer
    // detail page (no wrapper padding), the section's border-b spans
    // edge-to-edge while content stays inset — matches the spike's
    // visual exactly.
    <section className="bg-card px-4 pb-4 pt-4 border-b border-black/5 dark:border-white/5 md:px-6 md:pb-5 md:pt-6">
      <div className="flex items-start gap-3 md:gap-4">
        {/* Avatar — size-11 mobile / size-14 desktop matches spike */}
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-[15px] font-semibold text-foreground ring-1 ring-black/5 md:h-14 md:w-14 md:text-lg">
          {c.initials}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Name + karute # + status chip */}
          <div className="flex flex-wrap items-baseline gap-1.5">
            <h2 className="truncate text-[22px] font-semibold leading-tight tracking-tight text-foreground md:text-2xl">
              {c.name}
            </h2>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {c.karuteNumber}
            </span>
            {c.memberNumber && (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
                {tProfile('memberNumber', { number: c.memberNumber })}
              </span>
            )}
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.bg} ${status.text} ${status.border}`}
            >
              {t(`status.${c.status}`)}
            </span>
            {c.hasTicketPack && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300">
                <Ticket size={11} />
                {tProfile('ticketPack')}
              </span>
            )}
            {c.isBirthdayMonth && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-pink-200 bg-pink-50 px-2 py-0.5 text-[11px] font-medium text-pink-700 dark:border-pink-500/20 dark:bg-pink-500/10 dark:text-pink-300">
                <Cake size={11} />
                {tProfile('birthdayMonth')}
              </span>
            )}
          </div>

          {/* Meta — age/gender + visit count + last visit + usual
           *  service + joined date. The at-a-glance facts staff scans
           *  before a session, matching the spike's customer header. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {(c.age != null || c.gender) && (
              <span className="inline-flex items-center gap-1">
                <User size={12} className="text-muted-foreground/70" />
                {c.age != null && (
                  <span className="tabular-nums">{tProfile('ageValue', { age: c.age })}</span>
                )}
                {c.age != null && c.gender && <span> · </span>}
                {c.gender && <span>{c.gender}</span>}
              </span>
            )}
            {c.occupation && (
              <Meta icon={<Briefcase size={12} />}>
                <span>{c.occupation}</span>
              </Meta>
            )}
            <Meta icon={<Clipboard size={12} />}>
              <span className="tabular-nums">{Math.max(c.visitCount ?? 0, c.totalKarute)}</span>
              <span>{tProfile('visitCountSuffix')}</span>
            </Meta>
            <Meta icon={<Heart size={12} />}>
              <span className="text-muted-foreground/70">
                {tProfile('lastVisitPrefix')}
              </span>{' '}
              <span className="tabular-nums">{c.lastVisitDate ?? '—'}</span>
            </Meta>
            <Meta icon={<Sparkles size={12} />}>
              <span className="text-muted-foreground/70">
                {tProfile('usualServicePrefix')}
              </span>{' '}
              <span>{c.usualService ?? '—'}</span>
            </Meta>
            <Meta icon={<Calendar size={12} />}>
              {t('joined', { date: c.joinDate })}
            </Meta>
          </div>

          {/* Contact — phone + email */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Meta icon={<Phone size={12} />}>
              <span className="tabular-nums">{c.phone ?? '—'}</span>
            </Meta>
            <Meta icon={<Mail size={12} />}>{c.email ?? '—'}</Meta>
          </div>

          {/* Staff + next-visit prediction */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              {tProfile('staffPrefix')}{' '}
              <span className="text-foreground">
                {c.preferredStaffName ?? c.bookingStaffName ?? '—'}
              </span>
            </span>
            <span aria-hidden>·</span>
            {/* Only the prediction TEXT is dimmed; the 対応予定 chip stays full
             *  opacity so it reads the same as every other 対応予定 badge. */}
            <span className="inline-flex items-center gap-1.5">
              <span className="opacity-50">
                {t('row.recommendPrefix')}{' '}
                <span className="text-foreground">{c.nextVisitPredicted}</span>
              </span>
              <ComingSoonChip />
            </span>
          </div>

          {/* 録音 — start a recording for THIS customer (jumps to the recording
           *  tab; booking-or-walk-in resolved server-side). RED (recording) +
           *  subtle, placed BELOW the info so it can't be mis-tapped against the
           *  top-right edit pencil. */}
          <Link
            href={
              {
                pathname: '/sessions',
                query: { customerId: c.id },
              } as Parameters<typeof Link>[0]['href']
            }
            className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-semibold text-red-600 transition-colors hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
          >
            <Mic size={13} aria-hidden />
            {tProfile('record')}
          </Link>
        </div>

        {/* Top-right action: the edit pencil ONLY — the 録音 button sits below the
         *  info (red, subtle) so the two can't be confused or mis-tapped. */}
        <CustomerEditDialog customer={c} />
      </div>
    </section>
  )
}

function Meta({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground/70">{icon}</span>
      <span>{children}</span>
    </span>
  )
}
