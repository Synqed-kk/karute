'use client'

import React, { useState, useEffect, useRef } from 'react'
import { usePathname, Link } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'

import { Icon, type IconName } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

type SidebarLabelKey =
  | 'recording'
  | 'dashboard'
  | 'appointments'
  | 'customers'
  | 'karute'
  | 'askAi'
  | 'dataImport'
  | 'settings'

interface NavRoute {
  id: string
  href: string
  labelKey: SidebarLabelKey
  icon: IconName
}

const NAV_ROUTES: NavRoute[] = [
  { id: 'recording', href: '/sessions', labelKey: 'recording', icon: 'mic' },
  { id: 'dashboard', href: '/dashboard', labelKey: 'dashboard', icon: 'home' },
  { id: 'appointments', href: '/appointments', labelKey: 'appointments', icon: 'calendar' },
  { id: 'customers', href: '/customers', labelKey: 'customers', icon: 'users' },
  { id: 'karute', href: '/karute', labelKey: 'karute', icon: 'clipboard' },
  { id: 'askAi', href: '/ask-ai', labelKey: 'askAi', icon: 'sparkle' },
  { id: 'dataImport', href: '/data-import', labelKey: 'dataImport', icon: 'upload' },
  { id: 'settings', href: '/settings', labelKey: 'settings', icon: 'settings' },
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

const SWIPE_THRESHOLD = 50
const EDGE_ZONE = 30

export function Sidebar() {
  const pathname = usePathname()
  const t = useTranslations('sidebar')
  const activeId = NAV_ROUTES.find((r) => pathname.startsWith(r.href))?.id
  const [mobileOpen, setMobileOpen] = useState(false)

  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const swiping = useRef(false)

  function getLabel(key: SidebarLabelKey): string {
    try {
      return t(key)
    } catch {
      return LABEL_FALLBACKS[key]
    }
  }

  useEffect(() => {
    function handleTouchStart(e: TouchEvent) {
      const touch = e.touches[0]
      touchStartX.current = touch.clientX
      touchStartY.current = touch.clientY
      swiping.current = false
    }
    function handleTouchMove(e: TouchEvent) {
      const touch = e.touches[0]
      const dx = touch.clientX - touchStartX.current
      const dy = touch.clientY - touchStartY.current
      if (Math.abs(dy) > Math.abs(dx)) return
      if (Math.abs(dx) < 10) return
      swiping.current = true
    }
    function handleTouchEnd(e: TouchEvent) {
      if (!swiping.current) return
      const touch = e.changedTouches[0]
      const dx = touch.clientX - touchStartX.current
      if (!mobileOpen && dx > SWIPE_THRESHOLD && touchStartX.current < EDGE_ZONE) {
        setMobileOpen(true)
      } else if (mobileOpen && dx < -SWIPE_THRESHOLD) {
        setMobileOpen(false)
      }
      swiping.current = false
    }
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [mobileOpen])

  return (
    <>
      {!mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="fixed top-5 left-4 z-40 flex h-10 w-10 items-center justify-center rounded-sq-md bg-sq-bg-2 text-sq-text-2 shadow-sq-2 sm:hidden"
          aria-label="Open menu"
        >
          <Icon name="chevRight" size={20} />
        </button>
      )}

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 sm:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <nav
        className={cn(
          'flex h-full w-[220px] flex-col rounded-sq-lg border border-sq-stroke-1 bg-sq-bg-1 py-4',
          'max-sm:fixed max-sm:left-0 max-sm:top-0 max-sm:z-50 max-sm:h-screen max-sm:rounded-none max-sm:transition-transform max-sm:duration-200',
          mobileOpen ? 'max-sm:translate-x-0' : 'max-sm:-translate-x-full',
        )}
        aria-label="Main navigation"
      >
        <div className="flex flex-col gap-0.5 px-3">
          {NAV_ROUTES.map((route) => {
            const isActive = route.id === activeId
            return (
              <Link
                key={route.id}
                href={route.href as Parameters<typeof Link>[0]['href']}
                onClick={() => setMobileOpen(false)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-sq-md px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sq-accent-soft text-sq-accent-text'
                    : 'text-sq-text-2 hover:bg-sq-bg-2 hover:text-sq-text-1',
                )}
              >
                <Icon name={route.icon} size={18} />
                <span className="truncate">{getLabel(route.labelKey)}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
