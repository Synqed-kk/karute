'use client'

// THE OUTAGE SCREEN (Round 2, 2026-09-24, D-S16-4 — discussed with Liam, the
// lead's default, not a ruling). When the web cannot read the signed-in staff
// member's store (the assignment, the roster or the permission row), the app
// shell shows this and nothing else: no customer / karute / record data, and
// never a blank screen. Same layout as the unassigned screen, its own words:
// the title says what happened, the body what the person can do. It retries
// by itself — the layout gate is server-side, so a reload IS the retry.

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'

import { StoreGateScreen } from './UnassignedStoreScreen'

/** How often the screen retries on its own. */
export const OUTAGE_RETRY_MS = 30_000

export function StoreOutageScreen() {
  const t = useTranslations('storeOutage')
  useEffect(() => {
    const id = setInterval(() => window.location.reload(), OUTAGE_RETRY_MS)
    return () => clearInterval(id)
  }, [])
  return (
    <StoreGateScreen
      copy={{ title: t('title'), body: t('body'), recheck: t('retry'), rechecking: t('retrying'), logout: t('logout') }}
    />
  )
}
