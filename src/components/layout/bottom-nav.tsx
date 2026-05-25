'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname, Link } from '@/i18n/navigation'
import {
  Calendar,
  ClipboardList,
  Download,
  GraduationCap,
  Home,
  Mic,
  Sparkles,
  Upload,
  Users,
  Settings,
  Menu as MenuIcon,
  X,
} from 'lucide-react'

type Route = { href: string; label: string; icon: React.ComponentType<{ className?: string }> }

const PRIMARY: Route[] = [
  { href: '/appointments', label: 'appointments', icon: Calendar },
  { href: '/karute', label: 'karute', icon: ClipboardList },
  { href: '/customers', label: 'customers', icon: Users },
]

const MENU: Route[] = [
  { href: '/dashboard', label: 'dashboard', icon: Home },
  { href: '/coaching', label: 'coaching', icon: GraduationCap },
  { href: '/ask-ai', label: 'askAi', icon: Sparkles },
  { href: '/data-import', label: 'dataImport', icon: Upload },
  { href: '/data-export', label: 'dataExport', icon: Download },
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
  settings: 'Settings',
  recording: 'Recording',
  menu: 'Menu',
}

export function BottomNav() {
  const t = useTranslations('sidebar')
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

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
        className={`fixed inset-x-0 bottom-[80px] z-40 mx-auto max-w-md rounded-2xl border border-border bg-card p-2 shadow-2xl transition-all duration-200 ${
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
      <nav
        className="z-50 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary navigation"
      >
        <div className="relative mx-auto flex h-16 max-w-screen-sm items-stretch px-2">
          {renderNavItem(PRIMARY[0])}
          {renderNavItem(PRIMARY[1])}

          {/* Center mic FAB */}
          <div className="flex flex-1 items-start justify-center">
            <Link
              href={'/sessions' as Parameters<typeof Link>[0]['href']}
              onClick={() => setMenuOpen(false)}
              className="-translate-y-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-black/30 ring-4 ring-background transition-transform hover:scale-105 hover:bg-red-500/90"
              aria-label={label('recording')}
              aria-current={isActive('/sessions') ? 'page' : undefined}
            >
              <Mic className="h-6 w-6" />
            </Link>
          </div>

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
