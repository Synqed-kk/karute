// Router seed (packet 04 §Build 4): the smallest thing that makes more than one
// screen reachable. A hand-rolled path switch over the NavPort's usePathname —
// the web app has no client router dependency to reuse (Next owns routing
// there), and the nav port already provides history-API push/Link, so a
// dependency would add nothing. Screens fetch their own data via the DataPort
// on mount; no route-level loading magic.
//
// ponytail: flat path switch, no params/nesting — batch 3+ adds /customers/[id]
// style routes, upgrade to a tiny matcher then.

import { usePathname } from './ports/nav.vite'
import { AskAiScreen } from './screens/AskAiScreen'
import { CustomersScreen } from './screens/CustomersScreen'
import { ProfileProbeScreen } from './screens/ProfileProbeScreen'

export function ThinRouter() {
  const pathname = usePathname()
  if (pathname === '/ask-ai') return <AskAiScreen />
  if (pathname === '/customers') return <CustomersScreen />
  // Default (incl. the shell's /index.html entry): the packet-02 probe screen,
  // until batch 3 converts the profile to live data.
  return <ProfileProbeScreen />
}
