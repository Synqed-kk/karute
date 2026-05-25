'use client'

// LIFTED FROM SPIKE (structure: matches spike's CustomerHeaderCard.tsx)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute/CustomerHeaderCard.tsx
//
// Flat section (no card chrome) — bg-card + border-b only, edge-to-edge
// on mobile + desktop. Meta row shows: age · gender · visit count ·
// last visit · usual course · joined date — the at-a-glance facts
// staff scans before a session.

import {
  Calendar,
  Clipboard,
  Heart,
  Mail,
  Phone,
  Sparkles,
  User,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
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
    // No own px-4/md:px-6 — the (app) layout (and CustomerProfileView's
    // wrapping <main>) already provide horizontal padding. Adding more
    // here doubled it on the karute customer detail page (layout p-4 +
    // this px-4 = 32px from edge), pushing identity content further in
    // than the rest of the system. Vertical padding stays — the section
    // still owns its top/bottom spacing for the bg-card divider.
    <section className="bg-card pb-4 pt-4 border-b border-black/5 dark:border-white/5 md:pb-5 md:pt-6">
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
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.bg} ${status.text} ${status.border}`}
            >
              {t(`status.${c.status}`)}
            </span>
          </div>

          {/* Meta — age/gender + visit count + last visit + usual
           *  service + joined date. The at-a-glance facts staff scans
           *  before a session, matching the spike's customer header. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span
              className="inline-flex items-center gap-1 opacity-40"
              title="Coming soon — age + gender capture not in intake form yet"
            >
              <User size={12} className="text-muted-foreground/70" />
              <span className="tabular-nums">{c.age ?? '—'}</span>
              <span> · </span>
              <span>{c.gender ?? '—'}</span>
            </span>
            <Meta icon={<Clipboard size={12} />}>
              <span className="tabular-nums">{c.totalKarute}</span>
              <span>{' 回'}</span>
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
              担当{' '}
              <span className="text-foreground">
                {c.preferredStaffName ?? '—'}
              </span>
            </span>
            <span aria-hidden>·</span>
            <span
              className="inline-flex items-center gap-1.5 opacity-50"
              title="Coming soon — rebooking prediction not wired"
            >
              <span>
                推奨来店{' '}
                <span className="text-foreground">{c.nextVisitPredicted}</span>
              </span>
              <ComingSoonChip />
            </span>
          </div>
        </div>

        {/* Edit pencil — opens CustomerEditDialog. Form pre-populates
         *  with current customer data; save calls updateCustomer +
         *  revalidates the page so the header re-renders with new
         *  values. */}
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
