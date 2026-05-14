import { Calendar, Clipboard, Edit3, Mail, Phone, User } from 'lucide-react'
import type { CustomerProfileData } from '../types'
import { STATUS_STYLES } from '../types'

interface CustomerIdentityCardProps {
  c: CustomerProfileData
}

export function CustomerIdentityCard({ c }: CustomerIdentityCardProps) {
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
              {status.label}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <Meta icon={<User size={13} />}>
              <span className="tabular-nums">{c.age ?? '—'}</span>
              <span> · </span>
              <span>{c.gender ?? '—'}</span>
            </Meta>
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
            <span>
              Next visit predicted:{' '}
              <span className="text-foreground">{c.nextVisitPredicted}</span>
            </span>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Edit customer"
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
