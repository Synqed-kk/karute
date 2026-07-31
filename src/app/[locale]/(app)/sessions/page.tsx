import { getTranslations } from 'next-intl/server'
import { getCurrentUserStaffId, getStaffList } from '@/lib/staff'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getCustomer } from '@/lib/customers/queries'
import { getCustomerConsent } from '@/actions/customers'
import { listCustomerPacks, getCustomerLifecycleChecked } from '@/lib/packs/store'
import { getOrgSettings } from '@/actions/org-settings'
import { getAppointmentsByDate, getAppointmentById } from '@/actions/appointments'
import { getCustomerKaruteRecords } from '@/actions/karute'
import { getAiPreSessionBrief, type PreSessionBriefResult } from '@/lib/karute/ai-brief'
import { buildRecordScreen } from '@/lib/karute/record-screen'
import { RecordPageView } from '@/components/karute/redesign/record/RecordPageView'

export default async function SessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ appointmentId?: string; customerId?: string }>
}) {
  const { locale } = await params
  // `appointmentId` — a booking tapped on 予約. `customerId` — the 録音 button on
  // a customer card (record THAT customer, booking or walk-in).
  const { appointmentId: requestedAppointmentId, customerId: requestedCustomerId } =
    await searchParams

  const now = new Date()

  // Recording targets are TODAY's bookings (JST) — a session is recorded at
  // visit time, from getAppointmentsByDate (the same read 予約 uses).
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const todayStr = jstNow.toISOString().split('T')[0]

  // Wave 1 — every read that needs nothing but the request itself, fired
  // together (staff id, staff list, status translations, customer list, today's
  // bookings, org settings).
  const [activeStaffId, staffList, tStatus, customers, todayAppts, orgSettings] =
    await Promise.all([
      getCurrentUserStaffId(),
      getStaffList(),
      getTranslations('reservation.status'),
      getCachedCustomerList(),
      getAppointmentsByDate(todayStr),
      getOrgSettings(),
    ])

  // The assembly (target resolution + waves 2 + derivations) lives in the shared
  // core so the facade screen GET derives the identical view-model. The cookie
  // helpers are the injected deps here; the error posture (graceful null/[] on
  // the wave-2 reads, fail-closed lifecycle) is baked into the core.
  const screen = await buildRecordScreen({
    locale,
    now,
    requestedAppointmentId,
    requestedCustomerId,
    activeStaffId,
    staffList,
    customers,
    todayAppts,
    orgSettings,
    statusLabel: (key) => tStatus(key),
    deps: {
      resolveExplicitAppointment: (id) => getAppointmentById(id),
      resolveWalkInCustomer: (id) => getCustomer(id).catch(() => null),
      getTargetCustomer: (id) => getCustomer(id).catch(() => null),
      getConsent: (id) =>
        getCustomerConsent(id)
          .then((r) => r.consent)
          .catch(() => null),
      getKaruteRecords: (id, limit) => getCustomerKaruteRecords(id, limit),
      listPacks: (id) => listCustomerPacks(id),
      getLifecycle: (id) => getCustomerLifecycleChecked(id),
    },
  })

  // AI brief — fired WITHOUT await (streamed to the client, unwrapped with use()
  // inside the brief card's Suspense boundary so the page paints on the
  // mechanical brief and upgrades in place). Resolves to null on no-signal /
  // failure. Defaults to resolved-null when there's no recording target.
  const aiBriefPromise: Promise<PreSessionBriefResult | null> = screen.briefInputs
    ? getAiPreSessionBrief({
        ...screen.briefInputs,
        locale,
        now,
      }).catch(() => null)
    : Promise.resolve(null)

  return (
    <RecordPageView
      customers={customers}
      locale={locale}
      nextAppointment={screen.nextAppointment}
      nearbyBookings={screen.nearbyBookings}
      brief={screen.brief}
      aiBriefPromise={aiBriefPromise}
      recentRecordings={screen.recentRecordings}
      consentDate={screen.consentDate}
      visitSegment={screen.visitSegment}
      visitRhythm={screen.visitRhythm}
      targetHasTicketPack={screen.targetHasTicketPack}
      targetPack={screen.targetPack}
      packPresets={screen.packPresets}
      staffCanCustomizePacks={screen.staffCanCustomizePacks}
      previousPack={screen.previousPack}
      ticketsEnabled={screen.ticketsEnabled}
      noiseSuppression={screen.noiseSuppression}
      currentStaffName={screen.currentStaffName}
    />
  )
}
