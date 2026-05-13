import type { Customer } from '@/types/database'
import type { CustomerRowData } from '@synqed-kk/ui'

// ---------------------------------------------------------------------------
// Adapter: karute Customer rows -> synqed-ui CustomerRowData
// ---------------------------------------------------------------------------

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24)))
}

export function customersToRowData(customers: Customer[]): CustomerRowData[] {
  return customers.map((c) => {
    // Karute does not expose visit history in the list query — derive a
    // minimal placeholder shape so the row presenter has the fields it
    // requires. updated_at acts as a "last touch" stand-in.
    const lastTouch = c.updated_at ?? c.created_at ?? null
    const lastVisitDaysAgo = lastTouch
      ? daysBetween(new Date(), new Date(lastTouch))
      : 0
    return {
      id: c.id,
      name: c.name,
      initials: deriveInitials(c.name),
      age: '—',
      gender: '—',
      registeredDate: formatDate(c.created_at),
      staffName: '—',
      phone: c.phone,
      email: c.email,
      signalTone: 'on_track',
      signalLabel: 'Active',
      visitCount: 0,
      visitChain: [],
      lastVisitDate: formatDate(lastTouch),
      lastVisitDaysAgo,
    }
  })
}
