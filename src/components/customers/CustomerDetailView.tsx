'use client'

import { CustomerProfileIdentity, CustomerSessionHistory } from '@synqed-kk/ui'
import type { SessionHistoryItem } from '@synqed-kk/ui'
import type { CustomerIdentityProps } from '@/lib/adapters/customer-detail'

interface CustomerDetailViewProps {
  identity: CustomerIdentityProps
  sessions: SessionHistoryItem[]
  contact: {
    phone: string | null
    email: string | null
    furigana: string | null
  }
  notes?: string | null
}

export function CustomerDetailView({
  identity,
  sessions,
  contact,
  notes,
}: CustomerDetailViewProps) {
  const hasContact = !!(contact.phone || contact.email || contact.furigana)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <CustomerProfileIdentity {...identity} />

      {hasContact && (
        <section
          className="rounded-[var(--radius-md)] bg-[var(--color-bg-card)] p-4 ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          aria-label="Contact"
        >
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
            Contact
          </h2>
          <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            {contact.furigana && (
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Furigana</dt>
                <dd className="text-[var(--color-text)]">{contact.furigana}</dd>
              </div>
            )}
            {contact.phone && (
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Phone</dt>
                <dd className="text-[var(--color-text)]">{contact.phone}</dd>
              </div>
            )}
            {contact.email && (
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Email</dt>
                <dd className="text-[var(--color-text)] break-all">{contact.email}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {notes && (
        <section
          className="rounded-[var(--radius-md)] bg-[var(--color-bg-card)] p-4 ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          aria-label="Notes"
        >
          <h2 className="mb-1 text-sm font-semibold text-[var(--color-text)]">
            Notes
          </h2>
          <p className="text-sm text-[var(--color-text-muted)]">{notes}</p>
        </section>
      )}

      <CustomerSessionHistory sessions={sessions} />
    </div>
  )
}
