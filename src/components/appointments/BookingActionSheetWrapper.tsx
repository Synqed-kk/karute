'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BookingActionSheet } from '@synqed-kk/ui'
import { useRouter } from '@/i18n/navigation'
import type { ReservationView } from '@/lib/adapters/reservation-view'

interface BookingActionSheetWrapperProps {
  /** Currently selected booking — `null` keeps the sheet closed. */
  selected: ReservationView | null
  onClose: () => void
  /** Force the mobile bottom-sheet variant. Defaults to media-query detection. */
  forceMobile?: boolean
}

function deriveKaruteNumber(id: string): string {
  return id.replace(/-/g, '').slice(0, 5).toUpperCase()
}

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

  const open = selected !== null
  const hasKarute = selected?.karuteRecordId != null

  const onViewKarute = useCallback(() => {
    if (!selected?.karuteRecordId) return
    router.push(`/karute/${selected.karuteRecordId}` as Parameters<typeof router.push>[0])
    onClose()
  }, [selected, router, onClose])

  // New karute + Start recording both route to /sessions, which picks the next
  // unlinked appointment for the active staff. Per-appointment selection isn't
  // wired upstream yet — when it lands we'll thread the appointment id through.
  const onNewKarute = useCallback(() => {
    router.push('/sessions' as Parameters<typeof router.push>[0])
    onClose()
  }, [router, onClose])

  const onStartRecording = useCallback(() => {
    router.push('/sessions' as Parameters<typeof router.push>[0])
    onClose()
  }, [router, onClose])

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
        copy={{ honorific: t('card.customerSuffix') }}
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
      karuteNumber={
        selected.karuteRecordId
          ? deriveKaruteNumber(selected.karuteRecordId)
          : undefined
      }
      hasExistingKarute={hasKarute}
      isFirstTimeVisit={selected.isFirstTimeVisit}
      isMobile={forceMobile ?? isMobile}
      onViewKarute={onViewKarute}
      onNewKarute={onNewKarute}
      onStartRecording={onStartRecording}
      copy={{ honorific: t('card.customerSuffix') }}
    />
  )
}
