// Dashboard composition (Liam-approved redesign, 2026-07-02). Reading order =
// a practitioner's phone moments: who's next (hero) → what did I forget
// (todos) → my whole day (flow) → tomorrow → owner money (toggle-gated, last).
// Laws: every number is real data; empty sections render nothing; no stat
// tiles, no feeds, no placeholder boxes.

import { getTranslations } from 'next-intl/server'
import type { PackAlerts } from '@/lib/packs/alerts'
import type { ReconcileData } from '@/lib/packs/reconcile'
import { OnboardingBanner } from './OnboardingBanner'
import {
  NextCustomerHero,
  type HeroSlideView,
  type TomorrowFirstView,
} from './NextCustomerHero'
import { TodoCard, type KaruteTodoView } from './TodoCard'
import { DayFlow, type DayFlowRow } from './DayFlow'
import { TomorrowStrip, type TomorrowStripData } from './TomorrowStrip'
import { OwnerBand } from './OwnerBand'

interface DashboardPageViewProps {
  dateLabel: string
  isOwner: boolean
  onboardingComplete: boolean
  heroSlides: HeroSlideView[]
  heroTomorrow: TomorrowFirstView | null
  doneCount: number
  karuteTodos: KaruteTodoView[]
  redeemTodos: ReconcileData['entries']
  dayRows: DayFlowRow[]
  tomorrow: TomorrowStripData | null
  packAlerts: PackAlerts
  reconcile: ReconcileData
  canDismissAlerts: boolean
  pulse: { redemptions: number; karute: number }
}

export async function DashboardPageView({
  dateLabel,
  isOwner,
  onboardingComplete,
  heroSlides,
  heroTomorrow,
  doneCount,
  karuteTodos,
  redeemTodos,
  dayRows,
  tomorrow,
  packAlerts,
  reconcile,
  canDismissAlerts,
  pulse,
}: DashboardPageViewProps) {
  const t = await getTranslations('dashboard.flow')
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-6">
      {/* Chrome, not content: one slim row. The store pill lives in the app
       *  header above; greeting paragraphs don't survive the 5-second skim. */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[13px] text-muted-foreground">{dateLabel}</span>
        {isOwner && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground">
            {t('ownerChip')}
          </span>
        )}
      </div>

      {!onboardingComplete && <OnboardingBanner />}

      <NextCustomerHero slides={heroSlides} tomorrow={heroTomorrow} doneCount={doneCount} />

      <TodoCard karuteTodos={karuteTodos} redeemTodos={redeemTodos} />

      <DayFlow rows={dayRows} />

      <TomorrowStrip data={tomorrow} />

      {isOwner && (
        <OwnerBand
          alerts={packAlerts}
          reconcile={reconcile}
          canDismissAlerts={canDismissAlerts}
          pulse={pulse}
        />
      )}
    </div>
  )
}
