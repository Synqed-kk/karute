// Bottom navigation for the thin shell (packet-09 F-7 cause 3). The web
// BottomNav is NOT reused: it links to routes the thin router doesn't have
// (予約 / dashboard / coaching / settings / …) — every such tap would silently
// fall through to the customer list. This bar carries exactly the four routes
// that exist in thin/router.tsx and mirrors the web nav's visual language
// (top indicator bar, border-t/bg-card, icon + 10px label).
//
// Visibility mirrors AuthGate's "app mounted" condition — signed-in, or
// recovering with a known session. On the login screen it renders nothing.
// Safe-area: ThinShell's outer box already pads env(safe-area-inset-bottom);
// adding pb here would double-inset, so this bar deliberately doesn't.

import { useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { ClipboardList, Mic, Sparkles, Users } from 'lucide-react'
import {
  getSessionState,
  hasKnownSession,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'
import { Link, usePathname } from './ports/nav.vite'

const TABS = [
  { href: '/customers', label: 'customers', icon: Users },
  { href: '/karute', label: 'karute', icon: ClipboardList },
  { href: '/sessions', label: 'recording', icon: Mic },
  { href: '/ask-ai', label: 'askAi', icon: Sparkles },
] as const

// Active tab from the pathname, mirroring thin/router.tsx exactly:
// /karute + /karute/[id] → カルテ · /sessions → 録音 · /ask-ai → AI相談 ·
// everything else (incl. /customers/[id] and the router's fallthrough,
// e.g. the shell's /index.html entry) → 顧客.
function activeTab(pathname: string): (typeof TABS)[number]['href'] {
  if (pathname === '/karute' || pathname.startsWith('/karute/')) return '/karute'
  if (pathname === '/sessions') return '/sessions'
  if (pathname === '/ask-ai') return '/ask-ai'
  return '/customers'
}

export function ThinBottomNav() {
  const t = useTranslations('sidebar')
  const state = useSyncExternalStore(subscribeSessionState, getSessionState)
  const pathname = usePathname()
  const mounted =
    state.status === 'signed-in' ||
    (state.status === 'recovering' && hasKnownSession())
  if (!mounted) return null

  const active = activeTab(pathname)
  return (
    <nav
      className="z-50 border-t border-border bg-card"
      aria-label="Primary navigation"
    >
      <div className="relative mx-auto flex h-16 max-w-screen-sm items-stretch px-2">
        {TABS.map(({ href, label, icon: Icon }) => {
          const isActive = href === active
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors ${
                isActive
                  ? 'font-semibold text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {isActive && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 mx-auto h-0.5 w-10 rounded-full bg-primary"
                />
              )}
              <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
              <span className="text-[10px] font-medium leading-none">{t(label)}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
