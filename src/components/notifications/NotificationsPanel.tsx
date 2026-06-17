'use client'

// ─────────────────────────────────────────────────────────────
// NotificationsPanel — bell → side drawer of notifications
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: src/components/notifications/Notifications-
// Panel.tsx (full file, ~457 lines). Visual + flow preserved
// 1:1. Differences:
//
//   • i18n via next-intl keys instead of the spike's inline
//     ja / en Copy objects (matches the rest of the karute
//     redesign).
//   • Locale comes from useLocale() (next-intl) instead of the
//     spike's useTheme().language.
//   • State + mutations come from karute's hooks layer in
//     src/lib/notifications/hooks.ts (same pub/sub pattern as
//     spike).
//   • NO MOCK SEED. Empty state is the natural default.
//
// UX rules preserved verbatim from spike header:
//   - Opening the panel does NOT auto-mark-all-read. The badge
//     (booking items newer than the per-staff lastSeen cursor)
//     only clears when the panel CLOSES or "mark all read" is
//     tapped — both advance the cursor. Otherwise unread state is
//     noisy for someone who just glances at the panel.
//   - Empty state surfaces an affirming "all caught up" message.
//
// V1 READ MODEL (derived feed): items have no persisted per-row
// read_at — the feed is server-derived (buildNotificationFeed) and
// ephemeral. "Unread" = a BOOKING item created after the staff
// member last saw the panel (the lastSeen cursor in hooks.ts). So
// per-item unread styling keys off lastSeen, not item.readAt
// (which is always null on a derived item). markAllRead / close
// advance the cursor; markRead is a no-op in this model (kept for
// the prod-table swap).
//
// Navigation uses useRouter().push() (not <Link>) so the order
// is deterministic: mark read → close sheet → push. The spike's
// header comment explains the Next 16 + Turbopack race that
// drove this — preserved here.

import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import {
  AtSign,
  Bell,
  Brain,
  Calendar,
  CheckCheck,
  CreditCard,
  GraduationCap,
  Sparkles,
  Zap,
  ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  useNotifications,
  useNotificationMutations,
  useUnreadCount,
  useUnreadIds,
} from '@/lib/notifications/hooks'
import type {
  NotificationCategory,
  NotificationItem,
} from '@/lib/notifications/types'

interface NotificationsPanelProps {
  open: boolean
  onClose: () => void
}

// Category → icon + tint. Lifted from spike CATEGORY_META verbatim.
const CATEGORY_META: Record<
  NotificationCategory,
  { icon: LucideIcon; iconBg: string; iconColor: string }
> = {
  booking: {
    icon: Calendar,
    iconBg: 'bg-blue-50 dark:bg-blue-500/10',
    iconColor: 'text-blue-700 dark:text-blue-300',
  },
  billing: {
    icon: CreditCard,
    iconBg: 'bg-amber-50 dark:bg-amber-500/10',
    iconColor: 'text-amber-700 dark:text-amber-300',
  },
  memory_review: {
    icon: Brain,
    iconBg: 'bg-purple-50 dark:bg-purple-500/10',
    iconColor: 'text-purple-700 dark:text-purple-300',
  },
  customer_return: {
    icon: Sparkles,
    iconBg: 'bg-pink-50 dark:bg-pink-500/10',
    iconColor: 'text-pink-700 dark:text-pink-300',
  },
  mention: {
    icon: AtSign,
    iconBg: 'bg-indigo-50 dark:bg-indigo-500/10',
    iconColor: 'text-indigo-700 dark:text-indigo-300',
  },
  coaching: {
    icon: GraduationCap,
    iconBg: 'bg-emerald-50 dark:bg-emerald-500/10',
    iconColor: 'text-emerald-700 dark:text-emerald-300',
  },
  retention: {
    icon: ShieldCheck,
    iconBg: 'bg-gray-100 dark:bg-white/[0.06]',
    iconColor: 'text-gray-700 dark:text-gray-300',
  },
  system: {
    icon: Zap,
    iconBg: 'bg-gray-100 dark:bg-white/[0.06]',
    iconColor: 'text-gray-600 dark:text-gray-400',
  },
}

export function NotificationsPanel({
  open,
  onClose,
}: NotificationsPanelProps) {
  const router = useRouter()
  const items = useNotifications()
  const { markRead, markAllRead } = useNotificationMutations()
  const t = useTranslations('notifications')
  const locale = useLocale()
  const isEn = locale === 'en'
  // Capture "now" at panel-open so the grouping doesn't reshuffle
  // mid-view if the user lingers.
  const [now] = useState(() => Date.now())

  // V1 derived-feed read model: "unread" = the booking items the badge counts
  // (new since the per-staff lastSeen cursor). Single source — the header
  // badge and the per-row dot both read this, so they can never disagree.
  const unreadCount = useUnreadCount()
  const unreadIds = useUnreadIds()
  const hasUnread = unreadCount > 0

  const { today, thisWeek, older } = groupByAge(items, now)

  const handleItemClick = (item: NotificationItem) => {
    markRead(item.id)
    onClose()
    if (item.href) router.push(item.href)
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-[90%] flex-col gap-0 p-0 sm:max-w-sm"
      >
        <SheetHeader className="border-b border-black/5 px-4 pt-4 pb-3 dark:border-white/10">
          <SheetTitle className="flex items-center gap-2">
            <Bell className="size-4 text-foreground/80" aria-hidden />
            {t('title')}
            {hasUnread && (
              <span className="inline-flex h-5 items-center rounded-full bg-red-600 px-2 text-[11px] font-semibold tabular-nums text-white">
                {unreadCount}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t('description')}
          </SheetDescription>
        </SheetHeader>

        {/* Toolbar — only renders when there's at least one item. "Clear read"
         *  is dropped in the v1 derived model: there's no per-row dismiss to
         *  apply (the feed reflects live data), only the lastSeen cursor that
         *  "mark all read" advances. */}
        {items.length > 0 && (
          <div className="flex items-center gap-2 border-b border-black/5 px-4 py-2 dark:border-white/10">
            <button
              type="button"
              onClick={markAllRead}
              disabled={!hasUnread}
              className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium text-foreground/80 transition-colors hover:bg-gray-100 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.05]"
            >
              <CheckCheck className="size-3.5" aria-hidden />
              {t('markAllRead')}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <EmptyState t={t} />
          ) : (
            <>
              {today.length > 0 && (
                <Section title={t('today')}>
                  {today.map((n) => (
                    <NotificationRow
                      key={n.id}
                      item={n}
                      isUnread={unreadIds.has(n.id)}
                      onClick={() => handleItemClick(n)}
                      isEn={isEn}
                      now={now}
                      t={t}
                    />
                  ))}
                </Section>
              )}
              {thisWeek.length > 0 && (
                <Section title={t('thisWeek')}>
                  {thisWeek.map((n) => (
                    <NotificationRow
                      key={n.id}
                      item={n}
                      isUnread={unreadIds.has(n.id)}
                      onClick={() => handleItemClick(n)}
                      isEn={isEn}
                      now={now}
                      t={t}
                    />
                  ))}
                </Section>
              )}
              {older.length > 0 && (
                <Section title={t('older')}>
                  {older.map((n) => (
                    <NotificationRow
                      key={n.id}
                      item={n}
                      isUnread={unreadIds.has(n.id)}
                      onClick={() => handleItemClick(n)}
                      isEn={isEn}
                      now={now}
                      t={t}
                    />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────
// Section header — sticky within the scroll container
// ─────────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="sticky top-0 z-10 bg-card/95 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-md supports-backdrop-filter:bg-card/80">
        {title}
      </div>
      <div className="divide-y divide-black/5 dark:divide-white/10">
        {children}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Single row
// ─────────────────────────────────────────────────────────────

function NotificationRow({
  item,
  isUnread,
  onClick,
  isEn,
  now,
  t,
}: {
  item: NotificationItem
  /** v1: derived from the lastSeen cursor (booking items newer than it), not
   *  item.readAt — see the panel's V1 READ MODEL note. */
  isUnread: boolean
  onClick: () => void
  isEn: boolean
  now: number
  t: ReturnType<typeof useTranslations>
}) {
  const meta = CATEGORY_META[item.category]
  const Icon = meta.icon
  const title = isEn ? item.titleEn : item.titleJa
  const body = isEn ? item.bodyEn : item.bodyJa
  const relTime = formatRelTime(item.createdAt, now, isEn, t)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.02] active:bg-black/[0.03] dark:hover:bg-white/[0.02] dark:active:bg-white/[0.03] ${
        isUnread ? '' : 'opacity-70'
      }`}
    >
      <div
        className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${meta.iconBg}`}
      >
        <Icon className={`size-4 ${meta.iconColor}`} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-[13px] leading-snug ${
              isUnread ? 'font-semibold text-foreground' : 'text-foreground/85'
            }`}
          >
            {title}
          </span>
          {isUnread && (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-blue-600"
            />
          )}
        </div>
        {body && (
          <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {body}
          </div>
        )}
        <div className="mt-1 text-[11px] tabular-nums text-muted-foreground/80">
          {relTime}
        </div>
      </div>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// Empty state — affirming "all caught up". The scaffold pill (which
// explained the unwired data layer) is removed now that the feed is
// real: an empty panel genuinely means nothing needs attention.
// ─────────────────────────────────────────────────────────────

function EmptyState({
  t,
}: {
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-gray-100 dark:bg-white/[0.06]">
        <Bell className="size-6 text-gray-400 dark:text-gray-500" />
      </div>
      <div className="text-[14px] font-medium text-foreground">
        {t('emptyTitle')}
      </div>
      <div className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">
        {t('emptyBody')}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Grouping + relative-time — lifted from spike verbatim
// ─────────────────────────────────────────────────────────────

function groupByAge(
  items: NotificationItem[],
  now: number,
): {
  today: NotificationItem[]
  thisWeek: NotificationItem[]
  older: NotificationItem[]
} {
  const DAY = 24 * 60 * 60 * 1000
  const today: NotificationItem[] = []
  const thisWeek: NotificationItem[] = []
  const older: NotificationItem[] = []
  // Strict newest-first (user's mental model is chronological).
  const sorted = [...items].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  for (const n of sorted) {
    const age = now - new Date(n.createdAt).getTime()
    if (age < DAY) today.push(n)
    else if (age < 7 * DAY) thisWeek.push(n)
    else older.push(n)
  }
  return { today, thisWeek, older }
}

function formatRelTime(
  iso: string,
  now: number,
  isEn: boolean,
  t: ReturnType<typeof useTranslations>,
): string {
  const diffMs = now - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return t('justNow')
  if (mins < 60) return t('minutesAgo', { n: mins })
  const hours = Math.round(mins / 60)
  if (hours < 24) return t('hoursAgo', { n: hours })
  const days = Math.round(hours / 24)
  if (days < 7) return t('daysAgo', { n: days })
  // Older than a week — show the absolute date.
  try {
    return new Date(iso).toLocaleDateString(isEn ? 'en-US' : 'ja-JP', {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso.slice(0, 10)
  }
}
