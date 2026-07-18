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
import { CustomerProfileScreen } from './screens/CustomerProfileScreen'

// Single parameterized route this batch: /customers/{id} (no nesting). Exact
// paths are matched first so /customers (the list) never falls into this.
const PROFILE_PATH = /^\/customers\/([^/]+)$/

export function ThinRouter() {
  const pathname = usePathname()
  if (pathname === '/ask-ai') return <AskAiScreen />
  if (pathname === '/customers') return <CustomersScreen />
  if (pathname === '/karute') return <SessionsScreen />
  const profile = PROFILE_PATH.exec(pathname)
  if (profile) return <CustomerProfileScreen id={decodeURIComponent(profile[1])} />
  // Fallthrough (incl. the shell's /index.html entry): the customer list.
  return <CustomersScreen />
}
