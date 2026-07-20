// ホーム (dashboard) screen in the thin bundle (design-parity Gap B-1 PR 2) —
// retires its 準備中 placeholder. Fetches the screen-shaped DTO through the
// DataPort and renders the REAL DashboardPageView — the same leaf component
// tree the web page renders (PR 1 flipped DashboardPageView/AttentionCards/
// ActionCards/TomorrowStrip to 'use client'; OwnerBand's children
// (PackAlertsCard/ReconcileStrip/TodoCard) were already client components).
//
// Mutations: the pack-alert/reconcile/contact buttons inside OwnerBand and
// TodoCard import their actions directly from '@/actions/packs' (the Vite
// alias resolves to thin/ports/actions.vite.ts) — no extra wiring needed
// here. router.refresh() after a mutation re-fetches this screen's DTO via
// the nav-port refresh bus (#565 root fix, useScreenDto's subscribeRefresh).

import { DashboardPageView } from '@/components/dashboard/redesign/DashboardPageView'
import {
  DashboardScreenDTO,
  type DashboardScreenDTOType,
} from '@/lib/app-api/dashboard-screen-dto'
import { ScreenStates, useScreenDto } from './ScreenBoundary'

const parse = (raw: unknown): DashboardScreenDTOType => DashboardScreenDTO.parse(raw)

// Exported for the real-render prop-mapping smoke test (fleet P3 finding —
// this passthrough has zero real-render coverage, so a swapped/typo'd prop
// slot would only surface as a silent wrong-value bug in production).
export function DashboardScreenInner({ dto }: { dto: DashboardScreenDTOType }) {
  return (
    <DashboardPageView
      dateLabel={dto.dateLabel}
      isOwner={dto.isOwner}
      onboardingComplete={dto.onboardingComplete}
      heroSlides={dto.heroSlides}
      heroTomorrow={dto.heroTomorrow}
      doneCount={dto.doneCount}
      karuteTodos={dto.karuteTodos}
      redeemTodos={dto.redeemTodos}
      attentionItems={dto.attentionItems}
      totalToday={dto.totalToday}
      renewals={dto.renewals}
      rebooks={dto.rebooks}
      winbacks={dto.winbacks}
      tomorrow={dto.tomorrow}
      packAlerts={dto.packAlerts}
      reconcile={dto.reconcile}
      canDismissAlerts={dto.canDismissAlerts}
      pulse={dto.pulse}
      ticketsEnabled={dto.ticketsEnabled}
    />
  )
}

export function DashboardScreen() {
  const { state, retry } = useScreenDto('/api/app/v1/screens/dashboard', parse)
  return (
    <ScreenStates state={state} retry={retry}>
      {(dto) => <DashboardScreenInner dto={dto} />}
    </ScreenStates>
  )
}
