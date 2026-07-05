import { getLocale, getTranslations } from 'next-intl/server'
import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { getSynqedClient } from '@/lib/synqed/client'
import { CustomersListView } from '@/components/customers/redesign/list/CustomersListView'
import type { CustomerListRow } from '@/components/customers/redesign/types'
import {
  defaultAiPredict,
  resolveCustomerStatus,
  customerVisitCount,
  enrichCustomers,
  effectiveLastVisitIso,
  formatCompactDate,
  formatJoinDate,
  formatLastVisit,
  type LastVisitStrings,
} from '@/lib/customers/list-enrich'
import {
  assignSequentialKaruteNumbers,
  deriveFamilyInitials,
} from '@/lib/customers/identity'
import { listAllCustomers } from '@/lib/customers/list-all'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getBusinessId } from '@/lib/staff'
import { startTiming } from '@/lib/perf/timing'
import { listAllLifecycles, listAllPackUsage } from '@/lib/packs/store'
import { daysSince, resolvePackAlert } from '@/lib/packs/resolve'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string }>
}) {
  const { query: rawQuery } = await searchParams
  const query = rawQuery ?? ''

  const t = startTiming(`customers q="${query}"`)
  // Both are independent — getSynqedClient hits the auth layer while
  // resolveStoreScope reads capabilities + the active-store cookie; resolve in
  // parallel. The scope is the view lens for the 顧客 list: a cross-store viewer
  // gets their pinned store (null = all), a branch-restricted staff is clamped
  // to their own store (and search stays scoped via enforceStore).
  const [synqed, scope] = await Promise.all([
    getSynqedClient(),
    resolveStoreScope(),
  ])
  const enforceStore = scope.allowedStoreIds != null

  // Locale + translated relative-time strings, pulled once at page level
  // and threaded into the (synchronous) formatters so JP users see
  // "前回 2026年5月24日 (本日)" instead of "Today" / "May 24, 2026".
  const [list, staffList, activeStaffId, businessId, locale, lvT] = await Promise.all([
    // Page to completion — a tenant past 500 customers would otherwise drop
    // every row past #500 off the list (the server clamps page_size at 500).
    t.phase('customers.list', () =>
      listAllCustomers(synqed, {
        search: query.trim() || undefined,
        store_id: scope.storeId,
        enforceStore,
        sort_by: 'updated_at',
        sort_order: 'desc',
      }),
    ),
    t.phase('staffList', () => getStaffList()),
    t.phase('activeStaffId', () => getCurrentUserStaffId()),
    t.phase('businessId', () => getBusinessId()),
    getLocale(),
    getTranslations('customers.list.lastVisit'),
  ])

  const lastVisitStrings: LastVisitStrings = {
    noVisits: lvT('noVisits'),
    yearsAgo: (n) => lvT('yearsAgo', { n }),
    today: lvT('today'),
    oneDayAgo: lvT('oneDayAgo'),
    daysAgo: (n) => lvT('daysAgo', { n }),
    monthsAgo: (n) => lvT('monthsAgo', { n }),
  }

  const staffNameById = new Map(
    staffList.map((s) => [s.id, s.full_name ?? 'Unknown']),
  )

  const customerIds = list.customers.map((c) => c.id)
  // Pack usage + lifecycle load in parallel with the enrichment — both come
  // back as empty maps until the ticket_packs migration applies (graceful).
  const [enrichment, packUsageRaw, lifecycles, orgSettings] = await Promise.all([
    t.phase('enrichCustomers', () => enrichCustomers(businessId, customerIds)),
    listAllPackUsage(),
    listAllLifecycles(),
    getOrgSettings(),
  ])
  t.end()
  // 回数券 off (org setting): blank the usage map so the per-row ticket line,
  // 残N chip and pack alert all disappear (wave stays parallel; the QR
  // has_ticket_pack flag still feeds status resolution unchanged).
  const packUsage =
    (orgSettings?.ticket_packs_enabled ?? true)
      ? packUsageRaw
      : (new Map() as typeof packUsageRaw)

  // Sequential per-tenant karute numbers — sorted by created_at so the
  // oldest customer gets #00001, etc. Computed in-memory until Anthony
  // adds the real `customers.karute_number` column. Same helper used on
  // the profile page so a customer's number is consistent across views.
  const karuteNumberById = assignSequentialKaruteNumbers(list.customers)

  const rows: CustomerListRow[] = list.customers.map((c) => {
    const enriched = enrichment.get(c.id)
    // SDK-skew: local Customer type lags the API's QR fields — cast to read them.
    const qr = c as typeof c & {
      is_existing_customer?: boolean
      visit_count?: number
      has_ticket_pack?: boolean
      last_visit_at?: string | null
    }
    const lastVisitIso = effectiveLastVisitIso(
      enriched?.lastVisitIso,
      qr.last_visit_at,
    )
    const usage = packUsage.get(c.id)
    const lifecycle = lifecycles.get(c.id)
    // SINGLE SOURCE: same signals + same resolver the profile/recording/agenda
    // use, so the badge + 来店 count match everywhere for this customer.
    // hasTicketPack = QR flag OR a real ticket_packs ledger entry.
    const hasNextBooking = !!enriched?.nextAppointmentIso
    const statusSignals = {
      joinDateIso: c.created_at,
      lastVisitIso,
      hasUpcomingBooking: hasNextBooking,
      isExistingCustomer: qr.is_existing_customer,
      visitCount: qr.visit_count,
      karuteCount: enriched?.totalKarute,
      pastAppointmentCount: enriched?.pastAppointmentCount,
      hasTicketPack: (qr.has_ticket_pack ?? false) || (usage?.hasActivePack ?? false),
      // Staff lifecycle decision (卒業/離客) — outranks cadence in the resolver
      // so closed cases never fake-render as 休眠/要フォロー.
      lifecycleStatus: lifecycle?.status,
    }
    const status = resolveCustomerStatus(statusSignals)
    const last = formatLastVisit(lastVisitIso, locale, lastVisitStrings)
    // The displayed 来店 count = the unified visit count (max of QR visits +
    // recorded karute), not the karute count alone — matches the profile.
    const totalKarute = customerVisitCount(statusSignals)
    // 回数券 line + alert — resolvePackAlert is the single source (chopstick);
    // the dashboard/alert surfaces (P3b) reuse these identical inputs.
    const packAlert = usage
      ? resolvePackAlert({
          remainingTotal: usage.remaining,
          hasActivePack: usage.hasActivePack,
          daysSinceLastVisit: daysSince(lastVisitIso),
          hasNextBooking,
          lifecycleStatus: lifecycle?.status,
        })
      : null
    return {
      id: c.id,
      name: c.name,
      initials: deriveFamilyInitials(c.name),
      karuteNumber: karuteNumberById.get(c.id) ?? '#00000',
      // Stubs — these fields don't exist on the customer record yet.
      age: null,
      gender: null,
      joinDate: formatJoinDate(c.created_at, locale),
      joinDateIso: c.created_at ?? null,
      lastVisitDate: last.date,
      lastVisitAgo: last.ago,
      lastVisitService: enriched?.lastVisitService ?? null,
      aiPredict: defaultAiPredict(status),
      status,
      preferredStaffId: c.assigned_staff_id ?? null,
      preferredStaffName: c.assigned_staff_id
        ? (staffNameById.get(c.assigned_staff_id) ?? null)
        : null,
      bookingStaffId: enriched?.bookingStaffId ?? null,
      bookingStaffName: enriched?.bookingStaffId
        ? (staffNameById.get(enriched.bookingStaffId) ?? null)
        : null,
      totalKarute,
      phone: c.phone,
      pack: usage?.hasActivePack
        ? {
            remaining: usage.remaining,
            size: usage.size,
            unconsumed: usage.unconsumed,
          }
        : null,
      packAlert,
      // 案1: the list speaks in DAYS (前回 …6日前 / 登録 2日前); the one
      // calendar date that earns list space is the FUTURE booking, weekday
      // included (予約 6/15(火)) to match the reservation surfaces.
      joinAgo: formatLastVisit(c.created_at ?? null, locale, lastVisitStrings)
        .ago,
      nextBookingDate: formatCompactDate(
        enriched?.nextAppointmentIso ?? null,
        locale,
        new Date(),
        { withWeekday: true },
      ),
    }
  })

  // Project the staff roster into the lightweight shape the filter pills
  // need (id + display name + initials). Initials reuse `deriveInitials`
  // so the same algorithm runs for both customer avatars and staff pills
  // — kanji names get a single-char initial, ASCII names get first+last.
  const staffForFilter = staffList.map((s) => {
    const name = s.full_name ?? 'Unknown'
    return { id: s.id, name, initials: deriveFamilyInitials(name) }
  })

  return (
    <CustomersListView
      rows={rows}
      totalRegistered={list.total}
      query={query}
      selfStaffId={activeStaffId}
      bookingDataAvailable={enrichment.size > 0}
      staffList={staffForFilter}
    />
  )
}
