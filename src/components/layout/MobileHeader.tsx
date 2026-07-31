'use client'

// ─────────────────────────────────────────────────────────────
// MobileHeader — sticky top bar with back arrow + title + bell
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/layout/MobileHeader.tsx
// Karute adaptations:
//   - useT() → useTranslations() + locale-aware route matching
//   - useUnreadCount uses karute's existing notifications hook
//   - Recording-aware bell hiding: when staff is recording (state
//     ∈ {recording, paused}), the bell collapses to a spacer so
//     the floating DiscreetRecordingIndicator (layout-level, fixed
//     top-right) can occupy the corner without overlapping. Bell
//     returns the moment recording stops. This logic lived in
//     RecordPageHeader's local mobile chrome before MobileHeader
//     was introduced; centralised here so every (app) route gets
//     the same posture without per-page re-implementation.
//
// Mobile-only (md:hidden). Desktop uses the sidebar.
//
// THREE SLOTS:
//   left  — back arrow on sub-routes; empty spacer on bottom-tab roots
//   center — page title looked up from pathname
//   right — bell with notification count badge (hidden during recording)

import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { NotificationBell } from '@/components/notifications/NotificationBell'
import { StoreSwitcher } from '@/components/layout/StoreSwitcher'
import type { StoreRow } from '@/actions/stores'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'

export function MobileHeader({
  stores,
  activeStoreId,
}: {
  stores: StoreRow[]
  activeStoreId: string | null
}) {
  const pathname = usePathname()
  const router = useRouter()
  const tSidebar = useTranslations('sidebar')
  const tCommon = useTranslations('common')
  // Hide bell while recording — DiscreetRecordingIndicator (fixed
  // top-right, mounted at the (app) layout root) takes over the
  // corner. Staff aren't checking notifications mid-session anyway;
  // they're with the customer.
  const { state: recState } = useGlobalRecorder()
  const isRecording = recState === 'recording' || recState === 'paused'

  const title = titleFor(pathname, tSidebar)
  const showBack = isSubRoute(pathname)

  return (
    <header
      data-mobile-chrome="true"
      className="sticky top-0 z-30 border-b border-black/5 bg-white/80 pt-[env(safe-area-inset-top)] supports-backdrop-filter:bg-white/70 supports-backdrop-filter:backdrop-blur-xl md:hidden dark:border-white/10 dark:bg-neutral-900/85 supports-backdrop-filter:dark:bg-neutral-900/70"
    >
      <div className="relative flex h-14 items-center justify-between gap-1 px-2">
        {/* Center — title absolutely centred on the whole bar so it stays put
         *  no matter how wide the left/right clusters are (a wide store pill no
         *  longer shoves it off-centre). pointer-events-none so taps fall
         *  through to the back arrow / switcher / bell underneath; truncates
         *  rather than overlapping them on a very long title. */}
        <h1 className="pointer-events-none absolute left-1/2 top-1/2 max-w-[55%] -translate-x-1/2 -translate-y-1/2 truncate text-center text-[17px] font-semibold tracking-tight">
          {title}
        </h1>

        {/* Left — back arrow on sub-routes, spacer on bottom-tab roots */}
        {showBack ? (
          <button
            type="button"
            onClick={() => router.back()}
            aria-label={tCommon('back')}
            className="inline-flex size-11 items-center justify-center rounded-full text-gray-700 transition-colors active:bg-black/5 dark:text-gray-300"
          >
            <ChevronLeft className="size-5" />
          </button>
        ) : (
          <span aria-hidden className="size-11 shrink-0" />
        )}

        {/* Right — store switcher + shared NotificationBell (icon + unread
         *  badge + panel). Both hidden during recording so the layout-level
         *  DiscreetRecordingIndicator (fixed top-right) owns the corner without
         *  overlapping; the spacer holds the slot when the bell collapses. */}
        <div className="flex shrink-0 items-center gap-1">
          {!isRecording && (
            <StoreSwitcher stores={stores} activeStoreId={activeStoreId} variant="mobile" />
          )}
          {isRecording ? (
            <span aria-hidden className="size-11 shrink-0" />
          ) : (
            <NotificationBell variant="mobile" />
          )}
        </div>
      </div>
    </header>
  )
}

/** True for any page that isn't a bottom-nav root tab. The
 *  bottom nav owns the primary roots — adding a back arrow there
 *  would be redundant. Sub-routes (settings, coaching/*, profile,
 *  ask-ai, data-import, data-export, karute detail, sessions,
 *  welcome) get a back arrow so staff can undo a nav. */
function isSubRoute(pathname: string | null): boolean {
  if (!pathname) return false
  // Match the bottom-nav primary destinations. Same set rendered by
  // src/components/layout/bottom-nav.tsx. Unprefixed entries cover the thin
  // shell's single-locale router (its paths have no /ja|/en prefix); on the
  // web every pathname is locale-prefixed, so they can never match there.
  const bottomTabPrimary = [
    '/',
    '/ja',
    '/en',
    '/dashboard',
    '/ja/dashboard',
    '/en/dashboard',
    '/appointments',
    '/ja/appointments',
    '/en/appointments',
    '/karute',
    '/ja/karute',
    '/en/karute',
    '/customers',
    '/ja/customers',
    '/en/customers',
  ]
  return !bottomTabPrimary.includes(pathname)
}

/** Maps a route path to its display title. Locale-prefix
 *  stripping happens inline so a single match handles both
 *  /ja/* and /en/* paths. Falls back to "SYNQED". */
function titleFor(
  pathname: string | null,
  tSidebar: ReturnType<typeof useTranslations>,
): string {
  if (!pathname) return 'SYNQED'
  // Strip the locale prefix so all matches are locale-agnostic.
  const tail = pathname.replace(/^\/(ja|en)/, '')
  if (tail === '' || tail === '/') return tSidebar('dashboard')
  if (tail.startsWith('/dashboard')) return tSidebar('dashboard')
  if (tail.startsWith('/appointments')) return tSidebar('appointments')
  if (tail.startsWith('/customers')) return tSidebar('customers')
  if (tail.startsWith('/karute')) return tSidebar('karute')
  if (tail.startsWith('/sessions')) return tSidebar('recording')
  if (tail.startsWith('/coaching')) return tSidebar('coaching')
  if (tail.startsWith('/ask-ai')) return tSidebar('askAi')
  if (tail.startsWith('/data-import')) return tSidebar('dataImport')
  if (tail.startsWith('/data-export')) return tSidebar('dataExport')
  if (tail.startsWith('/profile')) return tSidebar('profile')
  if (tail.startsWith('/settings')) return tSidebar('settings')
  if (tail.startsWith('/welcome')) return 'SYNQED'
  return 'SYNQED'
}
