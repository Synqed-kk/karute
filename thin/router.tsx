// Router seed (packet 04 §Build 4), upgraded to a tiny param matcher in batch 3
// (packet 06 §Build 3): the flat exact-path switch now also matches the one
// parameterized route the app needs, /customers/[id] → the customer profile.
// A hand-rolled matcher, not a router dependency — the web app has no client
// router to reuse (Next owns routing there) and the nav port already provides
// history-API push/Link, so a dependency would add nothing. Screens fetch their
// own data via the DataPort on mount; no route-level loading magic.
//
// The packet-02 fixture probe screen retired here (its own comment promised it
// dies once the profile carries live data): /customers/[id] now renders the
// real CustomerProfileScreen, and the fallthrough lands on the customer list —
// the app's natural home + the surface you navigate a profile from.

import { usePathname } from './ports/nav.vite'
import { AskAiScreen } from './screens/AskAiScreen'
import { CustomersScreen } from './screens/CustomersScreen'
import { SessionsScreen } from './screens/SessionsScreen'
import { RecordScreen } from './screens/RecordScreen'
import { CustomerProfileScreen } from './screens/CustomerProfileScreen'
import { KaruteDetailScreen } from './screens/KaruteDetailScreen'

// A malformed escape in a deep link (/karute/%FF) must not URIError the whole
// router into its error path (Greptile P2 on #494) — fall back to the raw
// segment; a junk id then 404s downstream honestly.
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

// Parameterized routes (single-segment, no nesting). Exact paths are matched
// FIRST so /customers + /karute (the lists) never fall into these. The web's dead
// /karute/customer/[customerId] redirect shim is NOT ported — a two-segment suffix
// doesn't match the single-segment regex anyway (packet 07 §Build 5).
const PROFILE_PATH = /^\/customers\/([^/]+)$/
const KARUTE_DETAIL_PATH = /^\/karute\/([^/]+)$/

// Web routes the real chrome (BottomNav menu sheet, notification deep links)
// can reach that have NO thin screen YET — each lands on an explicit 準備中
// placeholder instead of silently falling through to the customer list (the
// F-7 wrong-screen class). This list SHRINKS to zero as the design-parity
// packets port each page; a route leaves it the moment its screen exists.
const PENDING_WEB_ROUTES = [
  '/appointments',
  '/dashboard',
  '/coaching',
  '/profile',
  '/settings',
  '/data-export',
  '/data-import',
  '/welcome',
]

// ponytail: hardcoded ja — the shell is single-locale and this screen dies as
// the parity packets land the real pages.
function PendingScreen() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-sm font-medium text-foreground">この画面は準備中です</p>
      <p className="text-xs text-muted-foreground">
        次のアップデートでご利用いただけます
      </p>
    </div>
  )
}

export function ThinRouter() {
  const pathname = usePathname()
  if (pathname === '/ask-ai') return <AskAiScreen />
  if (pathname === '/customers') return <CustomersScreen />
  if (pathname === '/karute') return <SessionsScreen />
  // Exact /sessions (record home) BEFORE the /karute/[id] param regex — no
  // shadowing either way (/sessions can't match /karute/(...), and /karute is an
  // exact match above).
  if (pathname === '/sessions') return <RecordScreen />
  const profile = PROFILE_PATH.exec(pathname)
  if (profile) return <CustomerProfileScreen id={safeDecode(profile[1])} />
  const karute = KARUTE_DETAIL_PATH.exec(pathname)
  if (karute) return <KaruteDetailScreen id={safeDecode(karute[1])} />
  if (PENDING_WEB_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`)))
    return <PendingScreen />
  // Fallthrough (incl. the shell's /index.html entry): the customer list.
  return <CustomersScreen />
}
