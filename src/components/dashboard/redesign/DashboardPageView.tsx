import type { BusinessProfile } from '@/lib/welcome/business-types'
import type { PackAlerts } from '@/lib/packs/alerts'
import { AIActionsHero } from './AIActionsHero'
import { DashboardHeader } from './DashboardHeader'
import { OnboardingBanner } from './OnboardingBanner'
import { PackAlertsCard } from './PackAlertsCard'
import {
  RecentKaruteCard,
  type DashboardRecentKarute,
} from './RecentKaruteCard'
import { StatStrip, type StatStripData } from './StatStrip'
import {
  TodaysAppointmentsCard,
  type DashboardAppointment,
} from './TodaysAppointmentsCard'

interface DashboardPageViewProps {
  staffName: string
  isOwner: boolean
  dateFormatted: string
  onboardingComplete: boolean
  businessProfile: BusinessProfile | null
  stats: StatStripData
  appointments: DashboardAppointment[]
  recentKarute: DashboardRecentKarute[]
  /** 離客/upsell alerts — card renders nothing when both lists are empty. */
  packAlerts: PackAlerts
  /** alerts.manage capability (manager+) — shows the dismiss buttons. */
  canDismissAlerts: boolean
}

export function DashboardPageView({
  staffName,
  isOwner,
  dateFormatted,
  onboardingComplete,
  businessProfile,
  stats,
  appointments,
  recentKarute,
  packAlerts,
  canDismissAlerts,
}: DashboardPageViewProps) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <DashboardHeader
        name={staffName}
        isOwner={isOwner}
        dateFormatted={dateFormatted}
        onboardingComplete={onboardingComplete}
      />

      {!onboardingComplete && <OnboardingBanner />}

      {/* 離客アラート — ABOVE everything else (Kitano: a prominent, always-
       *  visible place so staff can't forget to bring pack holders back). */}
      <PackAlertsCard alerts={packAlerts} canDismiss={canDismissAlerts} />

      <AIActionsHero businessProfile={businessProfile} />

      <StatStrip stats={stats} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TodaysAppointmentsCard appointments={appointments} />
        <RecentKaruteCard items={recentKarute} />
      </div>
    </div>
  )
}
