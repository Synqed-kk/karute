'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname, Link, useRouter } from '@/i18n/navigation'
import {
  Calendar,
  ClipboardList,
  Download,
  GraduationCap,
  Home,
  Mic,
  Sparkles,
  Square,
  Upload,
  UserRound,
  Users,
  Settings,
  Menu as MenuIcon,
  X,
} from 'lucide-react'
import type { NextCustomerInfo } from '@/lib/appointments/next-customer'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'

type Route = { href: string; label: string; icon: React.ComponentType<{ className?: string }> }

const PRIMARY: Route[] = [
  { href: '/appointments', label: 'appointments', icon: Calendar },
  { href: '/karute', label: 'karute', icon: ClipboardList },
  { href: '/customers', label: 'customers', icon: Users },
]

// /data-import stays flag-gated — its drop zone only fires
// console.info on file pick (no real upload yet). Coaching is a
// first-class destination now; the page itself gates its content
// per-account on the coaching entitlement (unlimited/paid see it,
// others get an upgrade prompt), so the nav link is always shown.
const MENU: Route[] = [
  { href: '/dashboard', label: 'dashboard', icon: Home },
  { href: '/coaching', label: 'coaching', icon: GraduationCap },
  { href: '/ask-ai', label: 'askAi', icon: Sparkles },
  ...(process.env.NEXT_PUBLIC_FEATURE_DATA_IMPORT === 'true'
    ? [{ href: '/data-import' as const, label: 'dataImport', icon: Upload }]
    : []),
  { href: '/data-export', label: 'dataExport', icon: Download },
  // Own-account profile (name/role/language/logout). Desktop reaches it via
  // the sidebar footer dropdown; this menu entry is the ONLY mobile path.
  { href: '/profile', label: 'profile', icon: UserRound },
  { href: '/settings', label: 'settings', icon: Settings },
]

const FALLBACK_LABELS: Record<string, string> = {
  appointments: 'Appointments',
  karute: 'Karute',
  customers: 'Customers',
  dashboard: 'Dashboard',
  coaching: 'Coaching',
  askAi: 'Ask AI',
  dataImport: 'Import',
  dataExport: 'Export',
  profile: 'Profile',
  settings: 'Settings',
  recording: 'Recording',
  menu: 'Menu',
  pickBooking: 'Pick booking',
}

interface BottomNavProps {
  /** Next-customer info fed from the layout. `null` falls back
   *  to the scaffold copy ("予約を選択" / "Pick booking"). */
  nextCustomer?: NextCustomerInfo | null
  /** Active locale — drives the honorific (「様」 in JA, empty in EN)
   *  and the minutes-from-now hint copy. */
  locale?: string
}

export function BottomNav({ nextCustomer = null, locale = 'ja' }: BottomNavProps = {}) {
  const t = useTranslations('sidebar')
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  // Center mic button label = customer name + honorific (「様」 in JA,
  // empty in EN), or the scaffold placeholder when there's nothing to
  // record. The time hint underneath is a LIVE countdown computed inside
  // CenterRecordButton (see useLiveHint) — not a server-baked string —
  // so it actually ticks down.
  const honorific = locale === 'ja' ? '様' : ''
  const centerLabel = nextCustomer
    ? `${nextCustomer.customerName}${honorific}`
    : label('pickBooking')

  function label(key: string): string {
    try {
      return t(key)
    } catch {
      return FALLBACK_LABELS[key] ?? key
    }
  }

  function isActive(href: string) {
    return pathname.startsWith(href)
  }

  function renderNavItem(route: Route) {
    const Icon = route.icon
    const active = isActive(route.href)
    return (
      <Link
        key={route.href}
        href={route.href as Parameters<typeof Link>[0]['href']}
        onClick={() => setMenuOpen(false)}
        className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors ${
          active
            ? 'font-semibold text-primary'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        aria-current={active ? 'page' : undefined}
      >
        {/* iOS-style active indicator — a 3px bar pinned to the top
         *  edge of the tab. Previous "just change text color to
         *  primary" was too subtle in karute's theme; this gives a
         *  clear visual anchor for the active tab. */}
        {active && (
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 mx-auto h-0.5 w-10 rounded-full bg-primary"
          />
        )}
        <Icon className={`h-5 w-5 ${active ? 'stroke-[2.5]' : ''}`} />
        <span className="text-[10px] font-medium leading-none">{label(route.label)}</span>
      </Link>
    )
  }

  return (
    <>
      {/* Slide-up menu sheet for secondary routes */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div
        className={`fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-2xl border border-border bg-card p-2 shadow-2xl transition-all duration-200 ${
          menuOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
        }`}
      >
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span className="text-xs font-medium text-muted-foreground">{label('menu')}</span>
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {MENU.map((route) => {
            const Icon = route.icon
            const active = isActive(route.href)
            return (
              <Link
                key={route.href}
                href={route.href as Parameters<typeof Link>[0]['href']}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-3 transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-muted'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-sm font-medium">{label(route.label)}</span>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Bottom tab bar — sits in the layout flex column so iOS Safari /
          in-app browser chrome can't occlude it. Parent layout uses h-dvh
          so the column fits the visible viewport. */}
      {/* z-40, deliberately UNDER the z-50 sheet/dialog overlays: a full-screen
       *  scrim must grey the tab bar too (inline overlays like
       *  CancelBookingSheet render earlier in the DOM, so an equal z-50 here
       *  would win the tie and paint the bar OVER the open sheet — in the
       *  thin shell that buried the sheet's bottom actions behind the bar).
       *  The メニュー scrim/panel above are z-40 EARLIER siblings, so the bar
       *  still paints over that scrim and the F-9 sheet geometry is unchanged. */}
      <nav
        className="z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary navigation"
      >
        <div className="relative mx-auto flex h-16 max-w-screen-sm items-stretch px-2">
          {renderNavItem(PRIMARY[0])}
          {renderNavItem(PRIMARY[1])}

          {/* Center mic FAB — role-aware per spike's BottomTabRecord-
           *  Button (synqed-karute-design-spike/src/components/layout/
           *   BottomTabRecordButton.tsx, lines 61-196).
           *
           *  Behavior matrix:
           *
           *    Recording + on /sessions      → tap STOPS the recording.
           *                                    Icon = stop-square,
           *                                    label = elapsed time.
           *    Recording + NOT on /sessions  → tap NAVIGATES to /sessions.
           *                                    Mic stays on. Icon = mic,
           *                                    label = elapsed time.
           *    Idle                          → tap navigates to /sessions
           *                                    (existing pre-flight). Icon
           *                                    = mic, label = next-
           *                                    customer name OR scaffold
           *                                    「予約を選択」. */}
          <CenterRecordButton
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
            nextCustomerName={centerLabel}
            isOnSessionsPage={isActive('/sessions')}
            ariaLabelIdle={
              nextCustomer
                ? locale === 'ja'
                  ? `${centerLabel}の録音準備画面を開く`
                  : `Open pre-session screen for ${centerLabel}`
                : label('recording')
            }
            nextCustomer={nextCustomer}
            locale={locale}
          />

          {renderNavItem(PRIMARY[2])}

          {/* Menu trigger */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={`flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors ${
              menuOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <MenuIcon className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-none">{label('menu')}</span>
          </button>
        </div>
      </nav>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// Live countdown for the center mic sub-label
// ─────────────────────────────────────────────────────────────
// Computed CLIENT-SIDE off the booking's absolute start/end timestamps
// and a ticking clock, so it updates in real time rather than freezing
// at whatever minute the server baked at page render. Phases (re-derived
// live, independent of the server's advisory `reason`):
//   • before start → 「あと{n}分」 / "in {n} min"  (until the booking starts)
//   • during       → 「残り{n}分」 / "{n} min left" (until the booking ends)
//   • ≤1 min left  → 「まもなく終了」 / "wrapping up"
//   • after end    → null (the booking's done; the server picks a new
//                    target on the next navigation/refresh)
// Kept inline (not message keys) like the original hint: both locales
// are handled here, so there's no English-on-JA leak — these are numeric
// format fragments, not translatable prose.
function useLiveHint(next: NextCustomerInfo | null, locale: string): string | null {
  // Seed from props only (no Date.now) so the server HTML and the first
  // client render match; the interval refines it immediately after mount.
  const [hint, setHint] = useState<string | null>(() => seedHint(next, locale))
  useEffect(() => {
    if (!next) {
      setHint(null)
      return
    }
    const tick = () => setHint(liveHint(next, Date.now(), locale))
    tick()
    // Minute-granularity countdown — 15s keeps the displayed minute fresh
    // without spinning a per-second timer the label doesn't need.
    const id = setInterval(tick, 15_000)
    return () => clearInterval(id)
  }, [next, locale])
  return hint
}

function seedHint(next: NextCustomerInfo | null, locale: string): string | null {
  if (!next) return null
  const ja = locale === 'ja'
  if (next.reason === 'in-session') return ja ? '施術中' : 'In session'
  if (next.minutesFromNow > 0) {
    return ja ? `あと${next.minutesFromNow}分` : `in ${next.minutesFromNow} min`
  }
  return null
}

function liveHint(
  next: NextCustomerInfo,
  nowMs: number,
  locale: string,
): string | null {
  const ja = locale === 'ja'
  const startMs = new Date(next.startTime).getTime()
  const endMs = new Date(next.endTime).getTime()
  // Before start → counts down to the booking start.
  if (nowMs < startMs) {
    const n = Math.max(1, Math.ceil((startMs - nowMs) / 60_000))
    return ja ? `あと${n}分` : `in ${n} min`
  }
  // During the booking → counts down the time remaining.
  if (nowMs < endMs) {
    const n = Math.ceil((endMs - nowMs) / 60_000)
    if (n <= 1) return ja ? 'まもなく終了' : 'wrapping up'
    return ja ? `残り${n}分` : `${n} min left`
  }
  // Past the end → no hint; the booking is over.
  return null
}

// ─────────────────────────────────────────────────────────────
// Center mic FAB — role-aware during recording
// ─────────────────────────────────────────────────────────────
// Splits into a separate component so its useGlobalRecorder
// subscription only re-renders the FAB cell, not the entire
// BottomNav (which would re-run the per-route active checks on
// every recording tick).
function CenterRecordButton({
  menuOpen,
  setMenuOpen,
  nextCustomerName,
  isOnSessionsPage,
  ariaLabelIdle,
  nextCustomer,
  locale,
}: {
  menuOpen: boolean
  setMenuOpen: (v: boolean) => void
  nextCustomerName: string
  isOnSessionsPage: boolean
  ariaLabelIdle: string
  nextCustomer: NextCustomerInfo | null
  locale: string
}) {
  const router = useRouter()
  const { state, startedAt, stopRecording } = useGlobalRecorder()
  // Live, ticking countdown for the idle sub-label (「あと5分」→「残り5分」→
  // 「まもなく終了」). Only surfaces in the idle branch below.
  const centerHint = useLiveHint(nextCustomer, locale)
  const isActive = state === 'recording' || state === 'paused'
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
  )
  useEffect(() => {
    if (state !== 'recording' || !startedAt) return
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [state, startedAt])

  const elapsedStr = (() => {
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  })()

  const closeMenuIfOpen = () => {
    if (menuOpen) setMenuOpen(false)
  }

  // Recording + viewing /sessions → stop button (with pulsing
  // ring + stop-square icon + elapsed-time label).
  if (isActive && isOnSessionsPage) {
    return (
      <div className="flex flex-1 flex-col items-center justify-start pt-1">
        <button
          type="button"
          onClick={() => {
            closeMenuIfOpen()
            stopRecording()
          }}
          aria-label="録音を停止"
          className="relative -mt-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/30 ring-4 ring-background transition-transform active:scale-95"
        >
          <span className="absolute inset-0 rounded-full bg-red-500/40 animate-ping" />
          <Square className="relative h-3.5 w-3.5" fill="currentColor" strokeWidth={0} />
        </button>
        <span className="mt-2 text-[10px] font-semibold leading-none tabular-nums text-red-600 dark:text-red-300">
          {elapsedStr}
        </span>
      </div>
    )
  }

  // Recording + NOT viewing /sessions → tap returns to /sessions
  // (mic stays on). Icon stays as Mic so the tap contract reads
  // "live, tap to view" rather than "tap to stop". Global stop
  // is always one tap away via the DiscreetRecordingIndicator's
  // long-press popover, so no stop affordance is lost here.
  if (isActive) {
    return (
      <div className="flex flex-1 flex-col items-center justify-start pt-1">
        <button
          type="button"
          onClick={() => {
            closeMenuIfOpen()
            router.push('/sessions')
          }}
          aria-label="録音画面に戻る"
          className="relative -mt-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-500/30 ring-4 ring-background transition-transform active:scale-95"
        >
          <span className="absolute inset-0 rounded-full bg-red-500/40 animate-ping" />
          <Mic className="relative h-5 w-5" strokeWidth={2.25} />
        </button>
        <span className="mt-2 text-[10px] font-semibold leading-none tabular-nums text-red-600 dark:text-red-300">
          {elapsedStr}
        </span>
      </div>
    )
  }

  // Idle → original Link behavior (navigate to /sessions).
  return (
    <div className="flex flex-1 flex-col items-center justify-start pt-1">
      <Link
        href={'/sessions' as Parameters<typeof Link>[0]['href']}
        onClick={closeMenuIfOpen}
        className="-mt-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-black/30 ring-4 ring-background transition-transform hover:scale-105 hover:bg-red-500/90"
        aria-label={ariaLabelIdle}
        aria-current={isOnSessionsPage ? 'page' : undefined}
      >
        <Mic className="h-5 w-5" />
      </Link>
      <span className="mt-2 max-w-[88px] truncate text-[10px] font-medium leading-none text-foreground">
        {nextCustomerName}
      </span>
      {centerHint && (
        <span className="mt-0.5 text-[9px] leading-none tabular-nums text-muted-foreground">
          {centerHint}
        </span>
      )}
    </div>
  )
}
