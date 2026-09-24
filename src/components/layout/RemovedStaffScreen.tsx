'use client'

// THE REMOVED SCREEN (Round 3 leg 1, 2026-09-24, D-S19-2 — the lead's
// decision, not a ruling). A manager removed this staff member from the
// business, but their web session is still live: the shell gate reads
// getBusinessId's membership_inactive and shows this, and nothing else — no
// nav, no data. Before this screen they got the OUTAGE screen, which told them
// their store could not be read and reloaded every 30 s forever. Removal is a
// fact, not an unknown: no retry button and no auto-reload, only sign-out.
// Same layout as the unassigned and outage screens, its own words.

import { useTranslations } from 'next-intl'

import { StoreGateScreen } from './UnassignedStoreScreen'

export function RemovedStaffScreen() {
  const t = useTranslations('removedStaff')
  return <StoreGateScreen copy={{ title: t('title'), body: t('body'), logout: t('logout') }} />
}
