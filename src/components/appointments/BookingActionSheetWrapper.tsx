'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BookingActionSheet, type BookingActionSheetCopy } from '@synqed-kk/ui'
import { useRouter } from '@/i18n/navigation'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import {
  UnassignedBookingSheet,
  type AssignableStaff,
} from '@/components/appointments/UnassignedBookingSheet'

interface BookingActionSheetWrapperProps {
  /** Currently selected booking — `null` keeps the sheet closed. */
  selected: ReservationView | null
  onClose: () => void
  /** Force the mobile bottom-sheet variant. Defaults to media-query detection. */
  forceMobile?: boolean
  /** bookings.manage — a 担当未定 booking offers the staff picker. */
  canAssign?: boolean
  /** The picker's list: the booking dialog's own store-scoped staff. */
  assignStaff?: readonly AssignableStaff[]
  /** booking id → the staff ids the booking's own store may offer; a booking
   *  missing here offers nobody (fail closed → the read-only lines). */
  assignStaffIdsByBooking?: Readonly<Record<string, readonly string[]>>
}

// `deriveKaruteNumber` removed — the hex slice produced an
// `#A1B2C`-style number that didn't match the real `#00001`
// sequence rendered on the karute list / customer profile.
// Passing `karuteNumber={undefined}` lets BookingActionSheet
// hide the chip instead of showing inconsistent IDs. ANTHONY:
// thread the real number through via the customer-list query
// + `assignSequentialKaruteNumbers` when this sheet needs it.

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = () => setIsMobile(mq.matches)
    handler()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

export function BookingActionSheetWrapper({
  selected,
  onClose,
  forceMobile,
  canAssign = false,
  assignStaff = [],
  assignStaffIdsByBooking = {},
}: BookingActionSheetWrapperProps) {
  const isMobile = useIsMobile()
  const router = useRouter()
  const t = useTranslations('reservation')
  const ta = useTranslations('reservation.actionSheet')

  const open = selected !== null
  // Show "view karute" when THIS booking already has one, OR when it's a returning
  // customer — they have karute history worth opening even on a fresh booking that
  // has no karute of its own yet. isFirstTimeVisit is derived from past-appointment
  // count, so !isFirstTimeVisit means a customer who's been in before.
  const isReturningCustomer = selected != null && !selected.isFirstTimeVisit
  const canViewKarute = selected?.karuteRecordId != null || isReturningCustomer

  const onViewKarute = useCallback(() => {
    if (!selected) return
    // This booking's own karute if it has one; otherwise the customer hub, where
    // their full karute history lives (/karute/customer/* now redirects here).
    const target = selected.karuteRecordId
      ? `/karute/${selected.karuteRecordId}`
      : `/customers/${selected.clientId}`
    router.push(target as Parameters<typeof router.push>[0])
    onClose()
  }, [selected, router, onClose])

  // New karute + Start recording both route to /sessions. Thread the tapped
  // booking's appointment id through as a query param so the record page loads
  // THAT booking as its target (customer + pre-session brief + consent) instead
  // of falling back to the active staff's next-booking guess.
  const goToRecord = useCallback(() => {
    const id = selected?.id
    router.push(
      (id
        ? { pathname: '/sessions', query: { appointmentId: id } }
        : '/sessions') as Parameters<typeof router.push>[0],
    )
    onClose()
  }, [selected, router, onClose])

  // Full action-sheet copy in the active locale. The sheet's own defaults are
  // English, so on /ja every label below honorific fell back to English. The
  // typed object means a mistyped key fails the build instead of silently
  // showing the English default.
  const copy: Partial<BookingActionSheetCopy> = {
    honorific: t('card.customerSuffix'),
    subtitleFirst: ta('subtitleFirst'),
    subtitleReturn: ta('subtitleReturn'),
    viewKarute: ta('viewKarute'),
    viewKaruteHint: ta('viewKaruteHint'),
    newKarute: ta('newKarute'),
    newKaruteHintFirst: ta('newKaruteHintFirst'),
    newKaruteHintReturn: ta('newKaruteHintReturn'),
    startRecording: ta('startRecording'),
    startRecordingHint: ta('startRecordingHint'),
    startRecordingHintFirst: ta('startRecordingHintFirst'),
    firstTimeNote: ta('firstTimeNote'),
  }

  // 担当未定 (PR-B Q2): a booking with no staff opens Karute's own sheet —
  // the staff picker for bookings.manage, a read-only note otherwise. The ui
  // sheet below only ever sees a booking that has a staff.
  const unassigned = selected?.staffId === null
  const sheetSelected = unassigned ? null : selected
  const offered = unassigned && selected ? (assignStaffIdsByBooking[selected.id] ?? []) : []
  const pickerStaff = assignStaff.filter((m) => offered.includes(m.id))

  return (
    <>
      <UnassignedBookingSheet
        booking={unassigned ? selected : null}
        canAssign={canAssign}
        staff={pickerStaff}
        isMobile={forceMobile ?? isMobile}
        onClose={onClose}
      />
      {sheetSelected ? (
        <BookingActionSheet
          open={open}
          onOpenChange={(o) => {
            if (!o) onClose()
          }}
          customerName={sheetSelected.customerName}
          karuteNumber={undefined}
          hasExistingKarute={canViewKarute}
          isFirstTimeVisit={sheetSelected.isFirstTimeVisit}
          isMobile={forceMobile ?? isMobile}
          onViewKarute={onViewKarute}
          onNewKarute={goToRecord}
          onStartRecording={goToRecord}
          copy={copy}
        />
      ) : (
        // Rendered closed so transitions don't snap.
        <BookingActionSheet
          open={false}
          onOpenChange={(o) => {
            if (!o) onClose()
          }}
          customerName=""
          hasExistingKarute={false}
          isFirstTimeVisit={false}
          isMobile={forceMobile ?? isMobile}
          copy={copy}
        />
      )}
    </>
  )
}
