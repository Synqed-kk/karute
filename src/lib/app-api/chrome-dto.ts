// Chrome screen DTO — the app-shell data the web (app) layout assembles
// server-side (design-parity Gap A): the bottom-nav center-mic target, the
// notification-bell feed, and the store-switcher rows. One fetch at boot
// (and on store switch), not per route.
//
// Notification hrefs are served SHELL-SHAPED (no locale prefix) — the thin
// nav is single-locale and a /ja-prefixed push would fall through the router.

import { z } from 'zod'

export const ChromeNextCustomerDTO = z.object({
  customerId: z.string(),
  customerName: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  reason: z.enum(['in-session', 'upcoming']),
  minutesFromNow: z.number(),
})

export const ChromeNotificationDTO = z.object({
  id: z.string(),
  category: z.enum([
    'booking',
    'billing',
    'memory_review',
    'customer_return',
    'mention',
    'coaching',
    'retention',
    'system',
  ]),
  titleJa: z.string(),
  titleEn: z.string(),
  bodyJa: z.string(),
  bodyEn: z.string(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
  href: z.string().nullable(),
})

// Slim on purpose: the switcher renders id/name/isPrimary only. The web
// StoreRow's counts (staff/customer) exist for the settings 店舗 list and are
// the heaviest reads in listStores — the chrome fetch skips them.
export const ChromeStoreDTO = z.object({
  id: z.string(),
  name: z.string(),
  isPrimary: z.boolean(),
  active: z.boolean(),
})

export const ChromeScreenDTO = z.object({
  /** The caller's staff/profile id — keys the per-staff unread cursor. */
  staffId: z.string(),
  nextCustomer: ChromeNextCustomerDTO.nullable(),
  notifications: z.array(ChromeNotificationDTO),
  stores: z.array(ChromeStoreDTO),
  /** The server-clamped active store (the `store-id` header after tenancy +
   *  assignment checks). null = unrestricted within the tenant. */
  activeStoreId: z.string().nullable(),
})

export type ChromeScreenDTOType = z.infer<typeof ChromeScreenDTO>
