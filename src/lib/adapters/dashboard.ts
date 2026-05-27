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
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatShortDate(iso: string): string {
  // "MM/DD" in JST. Manually composed because Intl's en-US "short" gives
  // M/D without zero-padding and ja-JP gives "MM月DD日" — neither matches
  // the existing format on the dashboard.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const m = fmt.find((p) => p.type === 'month')?.value ?? '01'
  const day = fmt.find((p) => p.type === 'day')?.value ?? '01'
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
