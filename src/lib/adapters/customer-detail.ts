import type { Customer } from '@/types/database'
import type {
  CustomerSignalTone,
  SessionHistoryAiTone,
  SessionHistoryConversion,
  SessionHistoryEntries,
  SessionHistoryItem,
} from '@synqed-kk/ui'

export interface AppointmentLike {
  id: string
  starts_at: string
  duration_minutes?: number | null
  title?: string | null
  staff_id: string
  status?: string
}

export interface StaffNameMap {
  [staffId: string]: string
}

export interface KaruteRecordWithEntries {
  id: string
  created_at: string
  session_date: string
  summary: string | null
  transcript: string | null
  staff_profile_id: string | null
  profiles: { full_name: string } | null
  entries: Array<{
    id: string
    category: string
    content: string
    source_quote: string | null
    confidence_score: number | null
    is_manual: boolean
    created_at: string
  }>
}

export interface CustomerIdentityProps {
  name: string
  initials: string
  age: number | string
  gender: string
  registeredDate: string
  visitCount: number
  staffName: string
  signalTone: CustomerSignalTone
  signalLabel: string
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function deriveSignal(visitCount: number, lastVisit: string | null): {
  tone: CustomerSignalTone
  label: string
} {
  if (visitCount === 0) return { tone: 'new', label: 'New' }
  if (visitCount === 1) return { tone: 'new', label: 'First visit' }
  if (!lastVisit) return { tone: 'on_track', label: 'Active' }

  const daysSince = Math.floor(
    (Date.now() - new Date(lastVisit).getTime()) / (1000 * 60 * 60 * 24),
  )
  if (daysSince > 90) return { tone: 'dormant_risk', label: 'Dormant' }
  if (daysSince > 60) return { tone: 'needs_followup', label: 'Needs follow-up' }
  return { tone: 'on_track', label: 'On track' }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function weekdayOf(iso: string): string {
  return WEEKDAYS[new Date(iso).getDay()]
}

const ENTRY_CATEGORY_TO_SLOT: Record<string, keyof SessionHistoryEntries> = {
  symptom: 'concern',
  concern: 'concern',
  body_area: 'condition',
  lifestyle: 'condition',
  treatment: 'treatment',
  product: 'product',
  preference: 'product',
  next_visit: 'next',
  next: 'next',
}

export function customerToIdentityProps(
  customer: Customer,
  visitCount: number,
  lastVisit: string | null,
  staffName: string,
): CustomerIdentityProps {
  const signal = deriveSignal(visitCount, lastVisit)
  return {
    name: customer.name,
    initials: deriveInitials(customer.name),
    age: '—',
    gender: '—',
    registeredDate: customer.created_at ? formatDate(customer.created_at) : '—',
    visitCount,
    staffName,
    signalTone: signal.tone,
    signalLabel: signal.label,
  }
}

export function appointmentsToSessionItems(
  appointments: AppointmentLike[],
  staffNames: StaffNameMap,
): SessionHistoryItem[] {
  return appointments.map((appt, index) => ({
    id: appt.id,
    dateDisplay: formatDate(appt.starts_at),
    weekday: weekdayOf(appt.starts_at),
    service: appt.title ?? 'Session',
    duration: appt.duration_minutes ?? 60,
    staffName: staffNames[appt.staff_id] ?? '—',
    summary: '',
    entryCount: 0,
    takeaways: [],
    entriesByCategory: {},
    memoryExtractedCount: 0,
    aiStatusTone: 'pending' as SessionHistoryAiTone,
    aiStatusLabel: 'No karute yet',
    conversionStatus: 'active' as SessionHistoryConversion,
    isLatest: index === 0,
  }))
}

export function karuteRecordsToSessionItems(
  records: KaruteRecordWithEntries[],
): SessionHistoryItem[] {
  return records.map((record, index) => {
    const entriesByCategory: SessionHistoryEntries = {}
    for (const e of record.entries) {
      const slot = ENTRY_CATEGORY_TO_SLOT[e.category] ?? 'concern'
      if (!entriesByCategory[slot]) entriesByCategory[slot] = []
      entriesByCategory[slot]!.push(e.content)
    }

    const aiStatusTone: SessionHistoryAiTone = record.summary
      ? 'summarized'
      : 'pending'
    const aiStatusLabel = record.summary ? 'Summarized' : 'Pending'

    const conversionStatus: SessionHistoryConversion = 'active'

    const takeaways = record.summary
      ? record.summary
          .split(/[.。]\s*/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 3)
      : []

    return {
      id: record.id,
      dateDisplay: formatDate(record.session_date),
      weekday: weekdayOf(record.session_date),
      service: 'Session',
      duration: 60,
      staffName: record.profiles?.full_name ?? '—',
      summary: record.summary ?? '',
      entryCount: record.entries.length,
      takeaways,
      entriesByCategory,
      memoryExtractedCount: 0,
      aiStatusTone,
      aiStatusLabel,
      conversionStatus,
      isLatest: index === 0,
    }
  })
}
