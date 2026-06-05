'use client'

// MATCHES SPIKE'S tab nav from src/app/[locale]/(app)/customers/[id]/page.tsx
// Horizontal-scroll on mobile, static on desktop. Active tab: no fill,
// blue underline + blue icon. Inactive: muted text, no underline.
// Count badge sits inline next to the label (same as spike).

import { Brain, CalendarClock, ClipboardList, Images, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'

export type CustomerProfileTab =
  | 'memory'
  | 'sessions'
  | 'bookings'
  | 'photos'
  | 'privacy'

interface CustomerTabBarProps {
  active: CustomerProfileTab
  onChange: (tab: CustomerProfileTab) => void
  counts: { memory: number; sessions: number; photos: number }
}

const TABS: Array<{
  id: CustomerProfileTab
  labelKey: string
  icon: typeof Brain
}> = [
  { id: 'memory', labelKey: 'memory', icon: Brain },
  { id: 'sessions', labelKey: 'sessions', icon: ClipboardList },
  { id: 'bookings', labelKey: 'bookings', icon: CalendarClock },
  { id: 'photos', labelKey: 'photos', icon: Images },
  { id: 'privacy', labelKey: 'privacy', icon: ShieldCheck },
]

export function CustomerTabBar({ active, onChange, counts }: CustomerTabBarProps) {
  const t = useTranslations('customers.profile.tabs')
  return (
    <nav
      aria-label={t('aria')}
      className="-mx-4 flex items-center gap-1 overflow-x-auto border-b border-black/5 px-4 dark:border-white/5 md:mx-0 md:overflow-visible md:px-0"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon
        const isActive = tab.id === active
        const count =
          tab.id === 'memory'
            ? counts.memory
            : tab.id === 'sessions'
              ? counts.sessions
              : tab.id === 'photos'
                ? counts.photos
                : undefined
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`relative inline-flex h-10 items-center gap-1.5 whitespace-nowrap px-3 text-[13px] font-medium transition-colors ${
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon
              size={14}
              className={
                isActive ? 'text-blue-600 dark:text-blue-300' : undefined
              }
              aria-hidden
            />
            <span>{t(tab.labelKey)}</span>
            {count !== undefined && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
            {isActive && (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-blue-600 dark:bg-blue-300"
              />
            )}
          </button>
        )
      })}
    </nav>
  )
}
