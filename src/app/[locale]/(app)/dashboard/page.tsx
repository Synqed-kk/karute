import { createClient } from '@/lib/supabase/server'
import { getLocale, getTranslations } from 'next-intl/server'
import { getStaffList, getCurrentUserStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { DashboardPageView } from '@/components/dashboard/redesign/DashboardPageView'
import { getDashboardData } from '@/lib/dashboard/cached'
import { getStaffColor } from '@/lib/staff/colors'
import { getBusinessProfile } from '@/lib/welcome/business-types'
import { startTiming } from '@/lib/perf/timing'
import type { DashboardAppointment, AppointmentStatusKey } from '@/components/dashboard/redesign/TodaysAppointmentsCard'
import type { DashboardRecentKarute } from '@/components/dashboard/redesign/RecentKaruteCard'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function hhmm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
// `deriveKaruteNumber` removed — the local hex-slice produced
// `#A1B2C` noise that didn't match the real `#00001` sequence used
// on the karute list + customer profile. Cards here pass
// `karuteNumber: null` so the conditional render hides the chip
// rather than showing inconsistent IDs. ANTHONY: thread the real
// value via the customer list query + `assignSequentialKaruteNumbers`
// when the dashboard surfaces need this back.
function formatLongDate(d: Date, locale: string): string {
  return d.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
function formatShortDate(d: Date, locale: string): string {
  return d.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default async function DashboardPage() {
  const t = startTiming('dashboard')
  const supabase = await createClient()

  const [
    {
      data: { user },
    },
    staffList,
    activeStaffId,
    dashboard,
    orgSettings,
    tStatus,
    locale,
  ] = await Promise.all([
    t.phase('authUser', () => supabase.auth.getUser()),
    t.phase('staffList', () => getStaffList()),
    t.phase('activeStaffId', () => getCurrentUserStaffId()),
    t.phase('dashboardData', () => getDashboardData()),
    t.phase('orgSettings', () => getOrgSettings()),
    getTranslations('reservation.status'),
    getLocale(),
  ])
  t.end()

  const activeStaff = staffList.find((s) => s.id === activeStaffId)
  const staffNameById = new Map(staffList.map((s) => [s.id, s.full_name ?? 'Unknown']))

  const now = new Date()
  const appointments: DashboardAppointment[] = dashboard.todayAppointments.map(
    (a) => {
      const start = new Date(a.start_time)
      const isPast = start.getTime() + a.duration_minutes * 60_000 < now.getTime()
      const hasRecording = !!a.karute_record_id
      const statusKey: AppointmentStatusKey = hasRecording
        ? 'completed'
        : isPast
          ? 'completed'
          : 'booked'
      // i18n via reservation.status — earlier version hardcoded
      // Japanese literals so EN locale rendered Japanese.
      const statusLabel =
        statusKey === 'completed' ? tStatus('completed') : tStatus('booked')
      return {
        id: a.id,
        time: hhmm(start),
        duration: a.duration_minutes,
        customerName: a.customers?.name ?? 'Unknown',
        // karuteNumber dropped — see top-of-file comment.
        karuteNumber: null,
        // a.title is the customer's booking note — '—' when null instead
        // of an English literal 'Session' masquerading as real data.
        service: a.title ?? '—',
        staffName: staffNameById.get(a.staff_profile_id) ?? 'Unknown',
        staffColor: getStaffColor(a.staff_profile_id),
        statusKey,
        statusLabel,
        reservationMemo: a.notes,
      }
    },
  )

  const recentKarute: DashboardRecentKarute[] = dashboard.recentKarute.map(
    (r) => {
      const dt = new Date(r.session_date ?? r.created_at)
      const entryCount = Array.isArray(r.entries)
        ? (r.entries[0]?.count ?? 0)
        : 0
      return {
        id: r.id,
        customerName: r.customers?.name ?? 'Unknown',
        // karuteNumber dropped — see top-of-file comment. Card renders
        // the row without the chip when null.
        karuteNumber: null,
        sessionDate: formatShortDate(dt, locale),
        summary: r.summary ?? '—',
        entryCount,
        staffName: r.staff_profile_id
          ? (staffNameById.get(r.staff_profile_id) ?? 'Unknown')
          : 'Unknown',
        staffColor: getStaffColor(r.staff_profile_id),
      }
    },
  )

  const stats = {
    weeklyRecordings: { value: dashboard.weeklyKaruteCount },
    todaysCustomers: { value: appointments.length },
    monthlyKarute: { value: dashboard.monthlyKaruteCount },
    // Stubbed — rebooking rate needs a returning-customer/total calc that we
    // haven't wired up yet. Render an em-dash placeholder.
    rebookingRate: { value: null },
  }

  const onboardingComplete = Boolean(orgSettings?.setup_completed_at)
  const businessProfile = orgSettings?.business_type
    ? getBusinessProfile(orgSettings.business_type)
    : null
  // Owner detection from the active staff's display_role. Earlier
  // hardcoded `true` made every signed-in user see the Crown
  // "Owner view" badge regardless of role. Now: only renders when
  // the active staff's display_role is 'owner'.
  const isOwner =
    (activeStaff as { display_role?: string | null } | null)?.display_role ===
    'owner'

  return (
    <DashboardPageView
      staffName={activeStaff?.full_name ?? user?.email ?? 'User'}
      isOwner={isOwner}
      dateFormatted={formatLongDate(now, locale)}
      onboardingComplete={onboardingComplete}
      businessProfile={businessProfile}
      stats={stats}
      appointments={appointments}
      recentKarute={recentKarute}
    />
  )
}
