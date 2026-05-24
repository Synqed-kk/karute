'use client'

// LIFTED FROM SPIKE (structure: matches spike's CustomerHeaderCard.tsx)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute/CustomerHeaderCard.tsx
//
// The previous version wrapped everything in a `rounded-2xl border bg-card
// shadow-sm` floating card, which was the "box around the customer's name"
// Liam flagged. Spike's pattern is FLAT: edge-to-edge `bg-card` section
// with a thin `border-b` at the bottom — no rounded corners, no shadow,
// no extra ring. Same treatment on mobile and desktop so the karute
// detail page reads as one continuous vertical stack of sections rather
// than mixing carded + flat blocks.

import { Calendar, Clipboard, Edit3, Mail, Phone, User } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { CustomerProfileData } from '../types'
import { STATUS_STYLES } from '../types'
import { ComingSoonChip } from '../ComingSoonChip'

interface CustomerIdentityCardProps {
  c: CustomerProfileData
}

export function CustomerIdentityCard({ c }: CustomerIdentityCardProps) {
  const t = useTranslations('customers.list')
  const status = STATUS_STYLES[c.status]
  return (
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
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.bg} ${status.text} ${status.border}`}
            >
              {t(`status.${c.status}`)}
            </span>
          </div>

          {/* Meta — age/gender (stub) + joined + visits */}
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
            <Meta icon={<Calendar size={12} />}>
              {t('joined', { date: c.joinDate })}
            </Meta>
            <Meta icon={<Clipboard size={12} />}>
              <span className="tabular-nums">{c.totalKarute}</span>
              <span> 回</span>
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

        {/* Edit pencil — flush right, matches spike's inline placement
         *  (replaces the absolute-positioned button pattern) */}
        <button
          type="button"
          disabled
          className="inline-flex h-8 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground/60 opacity-60"
          aria-label="Edit customer"
          title="Coming soon — inline edit not wired"
        >
          <Edit3 size={13} />
          <span className="hidden sm:inline">編集</span>
        </button>
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
