// Customer-list screen assembly — the row adaptation MOVED VERBATIM out of
// app/[locale]/(app)/customers/page.tsx (packet 04) so the web page and the
// facade screen endpoint share ONE source of truth for how a customer row is
// derived (status resolver, pack alert, karute numbering, staff mapping).
// Pure over explicit inputs: callers own their own fan-out (cookie-scoped on
// the web page, Bearer/business-scoped in the facade route).

import type { CustomerListRow } from '@/components/customers/redesign/types'
import type { StaffFilterEntry } from '@/components/customers/redesign/list/CustomersStaffFilter'
import {
  defaultAiPredict,
  effectiveLastVisitIso,
  formatCompactDate,
  formatJoinDate,
  formatLastVisit,
  type CustomerEnrichment,
  type LastVisitStrings,
} from '@/lib/customers/list-enrich'
import {
  resolveCustomerStatus,
  customerVisitCount,
} from '@/lib/customers/status-signals'
import {
  assignSequentialKaruteNumbers,
  deriveFamilyInitials,
} from '@/lib/customers/identity'
import type { listAllCustomers } from '@/lib/customers/list-all'
import type { CustomerPackUsage } from '@/lib/packs/store'
import type { CustomerLifecycle } from '@/lib/packs/types'
import { daysSince, resolvePackAlert } from '@/lib/packs/resolve'

export interface CustomersListScreen {
  rows: CustomerListRow[]
  totalRegistered: number
  /** False when enrichment came back empty (booking columns hide). */
  bookingDataAvailable: boolean
  staffList: StaffFilterEntry[]
}

export function buildCustomersListScreen(args: {
  list: Awaited<ReturnType<typeof listAllCustomers>>
  staffList: Array<{ id: string; full_name: string | null; isManagement?: boolean }>
  locale: string
  lastVisitStrings: LastVisitStrings
  enrichment: Map<string, CustomerEnrichment>
  packUsage: Map<string, CustomerPackUsage>
  lifecycles: Map<string, CustomerLifecycle>
  ticketPacksEnabled: boolean
}): CustomersListScreen {
  const { list, staffList, locale, lastVisitStrings, enrichment, lifecycles } = args

  // 回数券 off (org setting): blank the usage map so the per-row ticket line,
  // 残N chip and pack alert all disappear (the QR has_ticket_pack flag still
  // feeds status resolution unchanged).
  const packUsage = args.ticketPacksEnabled
    ? args.packUsage
    : (new Map() as typeof args.packUsage)

  const staffNameById = new Map(
    staffList.map((s) => [s.id, s.full_name ?? 'Unknown']),
  )

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
      noShowCount: enriched?.noShowCount ?? 0,
    }
  })

  // Project the staff roster into the lightweight shape the filter pills
  // need (id + display name + initials). Initials reuse `deriveInitials`
  // so the same algorithm runs for both customer avatars and staff pills
  // — kanji names get a single-char initial, ASCII names get first+last.
  const staffForFilter: StaffFilterEntry[] = staffList.map((s) => {
    const name = s.full_name ?? 'Unknown'
    return {
      id: s.id,
      name,
      initials: deriveFamilyInitials(name),
      isManagement: s.isManagement ?? false,
    }
  })

  return {
    rows,
    totalRegistered: list.total,
    bookingDataAvailable: enrichment.size > 0,
    staffList: staffForFilter,
  }
}
