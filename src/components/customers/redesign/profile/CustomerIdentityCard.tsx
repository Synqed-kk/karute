'use client'

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
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <div className="flex items-start gap-4 md:gap-6">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground md:h-16 md:w-16">
          {c.initials}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">
              {c.name}
            </h2>
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {c.karuteNumber}
            </span>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.bg} ${status.text} ${status.border}`}
            >
              {t(`status.${c.status}`)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span
              className="inline-flex items-center gap-1.5 opacity-40"
              title="Coming soon — age + gender capture not in intake form yet"
            >
              <User size={13} className="text-muted-foreground/70" />
              <span className="tabular-nums">{c.age ?? '—'}</span>
              <span> · </span>
              <span>{c.gender ?? '—'}</span>
            </span>
            <Meta icon={<Calendar size={13} />}>Joined {c.joinDate}</Meta>
            <Meta icon={<Clipboard size={13} />}>
              <span className="tabular-nums">{c.totalKarute}</span> visits
            </Meta>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <Meta icon={<Phone size={13} />}>
              <span className="tabular-nums">{c.phone ?? '—'}</span>
            </Meta>
            <Meta icon={<Mail size={13} />}>{c.email ?? '—'}</Meta>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              Preferred staff{' '}
              <span className="text-foreground">{c.preferredStaffName ?? '—'}</span>
            </span>
            <span aria-hidden>·</span>
            <span
              className="inline-flex items-center gap-1.5"
              title="Coming soon — rebooking prediction not wired"
            >
              <span className="opacity-40">
                Next visit predicted:{' '}
                <span className="text-foreground">{c.nextVisitPredicted}</span>
              </span>
              <ComingSoonChip />
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled
          className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground/60 opacity-60"
          aria-label="Edit customer"
          title="Coming soon — inline edit not wired"
        >
          <Edit3 size={13} />
          <span className="hidden md:inline">Edit</span>
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
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted-foreground/70">{icon}</span>
      <span>{children}</span>
    </span>
  )
}
