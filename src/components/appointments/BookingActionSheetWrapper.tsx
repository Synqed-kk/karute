'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BookingActionSheet, type BookingActionSheetCopy } from '@synqed-kk/ui'
import { useRouter } from '@/i18n/navigation'
import type { ReservationView } from '@/lib/adapters/reservation-view'

interface BookingActionSheetWrapperProps {
  /** Currently selected booking — `null` keeps the sheet closed. */
  selected: ReservationView | null
  onClose: () => void
  /** Force the mobile bottom-sheet variant. Defaults to media-query detection. */
  forceMobile?: boolean
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
}: BookingActionSheetWrapperProps) {
  const isMobile = useIsMobile()
  const router = useRouter()
  const t = useTranslations('reservation')
  const ta = useTranslations('reservation.actionSheet')

  const open = selected !== null
  const hasKarute = selected?.karuteRecordId != null

  const onViewKarute = useCallback(() => {
    if (!selected?.karuteRecordId) return
    router.push(`/karute/${selected.karuteRecordId}` as Parameters<typeof router.push>[0])
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

  if (!selected) {
    // Render the sheet closed so transitions don't snap.
    return (
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
    )
  }

  return (
    <BookingActionSheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      customerName={selected.customerName}
      karuteNumber={undefined}
      hasExistingKarute={hasKarute}
      isFirstTimeVisit={selected.isFirstTimeVisit}
      isMobile={forceMobile ?? isMobile}
      onViewKarute={onViewKarute}
      onNewKarute={goToRecord}
      onStartRecording={goToRecord}
      copy={copy}
    />
  )
}
