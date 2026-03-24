'use client'

import React, { useState } from 'react'
import { usePathname, Link, useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'

function MicIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
}
function HomeIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
}
function CalendarIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
}
function UsersIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
}
function ClipboardIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01" /></svg>
}
function SparklesIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /></svg>
}
function ImportIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M8 11l4 4 4-4" /><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" /></svg>
}
function SettingsIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
}

function MenuIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="18" y2="18" /></svg>
}

type SidebarLabelKey = 'recording' | 'dashboard' | 'appointments' | 'customers' | 'karute' | 'askAi' | 'dataImport' | 'settings'

type NavRoute = {
  id: string
  href: string
  labelKey: SidebarLabelKey
  icon: () => React.ReactElement
}

const NAV_ROUTES: NavRoute[] = [
  { id: 'recording', href: '/sessions', labelKey: 'recording', icon: MicIcon },
  { id: 'dashboard', href: '/dashboard', labelKey: 'dashboard', icon: HomeIcon },
  { id: 'appointments', href: '/appointments', labelKey: 'appointments', icon: CalendarIcon },
  { id: 'customers', href: '/customers', labelKey: 'customers', icon: UsersIcon },
  { id: 'karute', href: '/karute', labelKey: 'karute', icon: ClipboardIcon },
  { id: 'askAi', href: '/ask-ai', labelKey: 'askAi', icon: SparklesIcon },
  { id: 'dataImport', href: '/data-import', labelKey: 'dataImport', icon: ImportIcon },
  { id: 'settings', href: '/settings', labelKey: 'settings', icon: SettingsIcon },
]

const LABEL_FALLBACKS: Record<SidebarLabelKey, string> = {
  recording: 'Recording',
  dashboard: 'Dashboard',
  appointments: 'Appointments',
  customers: 'Customers',
  karute: 'Karute',
  askAi: 'Ask AI',
  dataImport: 'Import',
  settings: 'Settings',
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations('sidebar')
  const activeId = NAV_ROUTES.find((r) => pathname.startsWith(r.href))?.id
  const [mobileOpen, setMobileOpen] = useState(false)

  function getLabel(key: SidebarLabelKey): string {
    try {
      return t(key)
    } catch {
      return LABEL_FALLBACKS[key]
    }
  }

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed top-5 left-4 z-50 flex items-center justify-center w-10 h-10 rounded-xl bg-[#4a4a4a] text-white shadow-lg sm:hidden"
        aria-label="Open menu"
      >
        <MenuIcon />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 sm:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — always visible on sm+, slide-in on mobile */}
      <nav
        className={`
          flex h-full w-[90px] flex-col items-center rounded-[28px] bg-[#4a4a4a] py-4 gap-0.5
          max-sm:fixed max-sm:left-0 max-sm:top-0 max-sm:z-50 max-sm:h-screen max-sm:rounded-none max-sm:transition-transform max-sm:duration-200
          ${mobileOpen ? 'max-sm:translate-x-0' : 'max-sm:-translate-x-full'}
        `}
        aria-label="Main navigation"
      >
        {NAV_ROUTES.map((route) => {
          const isActive = route.id === activeId
          const Icon = route.icon

          return (
            <Link
              key={route.id}
              href={route.href as Parameters<typeof Link>[0]['href']}
              onClick={() => setMobileOpen(false)}
              className={`flex w-full flex-col items-center gap-1 px-2 py-2.5 transition min-h-[44px] min-w-[44px] ${
                isActive ? 'text-white' : 'text-white/60 hover:text-white/90'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon />
              <span className="w-full truncate text-center text-[10px] font-medium">{getLabel(route.labelKey)}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
