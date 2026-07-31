'use client'

// ─────────────────────────────────────────────────────────────
// NotificationBell — the single bell affordance (icon + red unread
// badge + the NotificationsPanel drawer).
// ─────────────────────────────────────────────────────────────
// SINGLE SOURCE so the desktop header (CustomersListHeader, hidden md:block)
// and the mobile header (MobileHeader, md:hidden) can't diverge — they both
// render this. Only one is ever visible at a given width.
//
// Closing the panel advances the per-staff lastSeen cursor (markAllRead),
// which clears the badge — matching the panel's documented UX: opening does
// NOT auto-clear, closing (and explicit mark-all-read) does.

import { useState } from 'react'
import { Bell } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { NotificationsPanel } from '@/components/notifications/NotificationsPanel'
import {
  formatUnreadBadge,
  useNotificationMutations,
  useUnreadCount,
} from '@/lib/notifications/hooks'

interface NotificationBellProps {
  /** Visual variant — desktop header bell is a small ghost button; mobile is
   *  the larger 44px touch target. Defaults to mobile (the larger target). */
  variant?: 'mobile' | 'desktop'
}

export function NotificationBell({ variant = 'mobile' }: NotificationBellProps) {
  const t = useTranslations('common')
  const unreadCount = useUnreadCount()
  const { setLastSeen } = useNotificationMutations()
  const [open, setOpen] = useState(false)

  // Closing the panel marks everything seen → clears the badge.
  const handleClose = () => {
    setOpen(false)
    setLastSeen()
  }

  if (variant === 'desktop') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('notifications')}
          className="absolute right-0 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold leading-none tabular-nums text-white ring-2 ring-background"
            >
              {formatUnreadBadge(unreadCount)}
            </span>
          )}
        </button>
        <NotificationsPanel open={open} onClose={handleClose} />
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('notifications')}
        className="relative inline-flex size-11 items-center justify-center rounded-full text-gray-700 transition-colors active:bg-black/5 dark:text-gray-300"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none tabular-nums text-white ring-2 ring-white dark:ring-neutral-900"
          >
            {formatUnreadBadge(unreadCount)}
          </span>
        )}
      </button>
      <NotificationsPanel open={open} onClose={handleClose} />
    </>
  )
}
