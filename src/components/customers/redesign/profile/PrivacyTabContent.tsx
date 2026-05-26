import { AlertCircle, Clock, Upload } from 'lucide-react'
import { ComingSoonChip } from '../ComingSoonChip'

interface PrivacyTabContentProps {
  customerName: string
}

export function PrivacyTabContent({ customerName }: PrivacyTabContentProps) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-300">
          <AlertCircle size={16} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Privacy &amp; data</h3>
            <ComingSoonChip />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            APPI (Japan&apos;s Personal Information Protection Act) compliance
            actions for {customerName}&apos;s data. Owner or assigned-staff
            privileges required.
          </p>
        </div>
      </header>

      <ul className="flex flex-col gap-3">
        <PrivacyAction
          tone="blue"
          icon={<Clock size={16} />}
          title="Access history"
          body={`See which staff accessed or modified ${customerName}'s data in the audit log.`}
          cta="View history"
          ctaTone="blue"
        />
        <PrivacyAction
          tone="neutral"
          icon={<Upload size={16} />}
          title="Export data"
          body="Exports profile, karute, memory, photos, and recording transcripts as an encrypted PDF (signed URL, 24h TTL)."
          cta="Export"
          ctaTone="ghost"
        />
        <PrivacyAction
          tone="danger"
          icon={<AlertCircle size={16} />}
          title="Delete customer data"
          body="Soft-deletes all data and schedules permanent deletion in 30 days (APPI's reasonable window). Cascade: karute, memory, photos, recordings. Undoable within 30 days."
          cta="Delete data"
          ctaTone="danger"
        />
      </ul>

      <footer className="mt-4 flex items-start gap-1.5 rounded-lg border border-border bg-background/40 px-3 py-2.5 text-[11px] text-muted-foreground">
        <AlertCircle size={12} className="mt-0.5 shrink-0" />
        <span>
          These actions are logged to the audit trail. Deletion is irreversible
          after 30 days. Owner confirmation recommended before execution.
        </span>
      </footer>
    </section>
  )
}

function PrivacyAction({
  tone,
  icon,
  title,
  body,
  cta,
  ctaTone,
}: {
  tone: 'blue' | 'neutral' | 'danger'
  icon: React.ReactNode
  title: string
  body: string
  cta: string
  ctaTone: 'blue' | 'ghost' | 'danger'
}) {
  const toneClasses =
    tone === 'blue'
      ? 'border-sky-500/30 bg-sky-500/5'
      : tone === 'danger'
        ? 'border-red-500/30 bg-red-500/5'
        : 'border-border bg-background/40'
  const iconBg =
    tone === 'blue'
      ? 'bg-sky-500/15 text-sky-300'
      : tone === 'danger'
        ? 'bg-red-500/15 text-red-300'
        : 'bg-muted text-muted-foreground'
  const btnClasses =
    ctaTone === 'blue'
      ? 'bg-sky-500 text-white hover:bg-sky-600'
      : ctaTone === 'danger'
        ? 'bg-red-500 text-white hover:bg-red-600'
        : 'border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
  return (
    <li className={`flex items-start gap-3 rounded-xl border p-3 ${toneClasses}`}>
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}
      >
        {icon}
      </span>
      <div className="flex flex-1 flex-col gap-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      <button
        type="button"
        disabled
        className={`inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-semibold opacity-60 ${btnClasses}`}
        title="Wiring pending — APPI compliance backend in flight"
      >
        {cta}
      </button>
    </li>
  )
}
