// The web (app) layout's chrome, mounted in the thin tree (design-parity
// Gap A): the REAL BottomNav (3 tabs + center mic + メニュー sheet) and
// MobileHeader (back/title/store-switcher/bell), both fed from the chrome
// DTO via the module store. Two mount points because ThinShell pins the nav
// in its own fixed wrapper OUTSIDE <main> (packet-09 F-7 cause 3 — it must
// clear the home indicator and never scroll with content).

import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { BottomNav } from '@/components/layout/bottom-nav'
import { MobileHeader } from '@/components/layout/MobileHeader'
import { NotificationsProvider } from '@/lib/notifications/context'
import type { StoreRow } from '@/actions/stores'
import {
  getSessionState,
  hasKnownSession,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'
import { useChromeDto } from './chrome-store'

/** Nav for the ThinShell slot. Same mounted-app gate as the AuthGate:
 *  signed-in or an offline resume with a known session; hidden on the login
 *  screen and the cold-boot loading frame. */
export function ThinChromeNav() {
  const state = useSyncExternalStore(subscribeSessionState, getSessionState)
  const chrome = useChromeDto()
  const mounted =
    state.status === 'signed-in' ||
    (state.status === 'recovering' && hasKnownSession())
  if (!mounted) return null
  return <BottomNav nextCustomer={chrome?.nextCustomer ?? null} locale="ja" />
}

/** Header + web-layout content frame around the authed screens (rendered as
 *  the AuthGate's child, so it only exists in the mounted-app states). */
export function ThinChromeContent({ children }: { children: ReactNode }) {
  const chrome = useChromeDto()
  // The switcher renders id/name/isPrimary only — the StoreRow counts exist
  // for the settings 店舗 list, which the chrome DTO deliberately skips.
  const stores: StoreRow[] = (chrome?.stores ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    isPrimary: s.isPrimary,
    active: s.active,
    address: null,
    phone: null,
    staffCount: 0,
    customerCount: 0,
    businessType: null,
  }))
  return (
    <NotificationsProvider
      feed={chrome?.notifications ?? []}
      staffId={chrome?.staffId ?? null}
    >
      <MobileHeader stores={stores} activeStoreId={chrome?.activeStoreId ?? null} />
      {/* The web layout's content frame — screens are authored against it
       *  (max-w clamp + the vertical-only padding rule). Bottom padding =
       *  nav clearance under the root-scroller shell: the bar's real box
       *  (4rem row + 1px border + safe-area inset, bottom-nav.tsx:194/197)
       *  + this frame's own 1rem (1.5rem at md:) breathing room — the same
       *  gap the old in-flow arrangement produced. Chrome-gated here (not on
       *  <main>) so login/boot never inherit dead padding. */}
      <div className="mx-auto max-w-7xl py-4 pb-[calc(5rem+1px+env(safe-area-inset-bottom))] md:py-6 md:pb-[calc(5.5rem+1px+env(safe-area-inset-bottom))]">
        {children}
      </div>
    </NotificationsProvider>
  )
}
