import type {
  AppointmentRowData,
  DashboardStatCardData,
  RecentKaruteItem,
} from '@synqed-kk/ui'

// ---------------------------------------------------------------------------
// Adapter: dashboard data shapes -> synqed-ui prop shapes
// ---------------------------------------------------------------------------

export interface DashboardAppointmentInput {
  id: string
  startTime: string
  durationMinutes: number
  staffId: string
  customerName: string
  staffName: string
}

export interface DashboardKaruteInput {
  id: string
  summary: string | null
  createdAt: string
  staffId: string
  customerName: string
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}/${day}`
}

export interface DashboardAppointmentRow extends AppointmentRowData {
  id: string
}

export function appointmentsToRowData(
  appts: DashboardAppointmentInput[],
): DashboardAppointmentRow[] {
  return appts.map((a) => ({
    id: a.id,
    time: formatTime(a.startTime),
    durationMinutes: a.durationMinutes,
    customerName: a.customerName,
    service: 'Session',
    staffName: a.staffName,
    statusLabel: 'Upcoming',
    statusTone: 'info',
  }))
}

export function karuteToRecentItems(
  karute: DashboardKaruteInput[],
): RecentKaruteItem[] {
  return karute.map((r) => ({
    id: r.id,
    customerName: r.customerName,
    sessionDate: formatShortDate(r.createdAt),
    summary: r.summary ?? '—',
    entryCount: 0,
    staffName: '—',
  }))
}

export function buildDashboardStats(
  recordingsThisWeek: number,
  customersToday: number,
  karuteGenerated: number,
): DashboardStatCardData[] {
  return [
    { label: 'Recordings this week', value: recordingsThisWeek },
    { label: 'Customers today', value: customersToday },
    { label: 'Karute generated', value: karuteGenerated },
  ]
}
