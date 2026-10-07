'use client'

// 担当未定 (PR-B Q2): the sheet a booking with NO staff opens instead of the
// @synqed-kk/ui BookingActionSheet, which has no slot for a staff picker and
// always renders a record row (a staff-less booking is not a recording
// target). Same primitives as the ui sheet — Sheet side="bottom" on a phone,
// Dialog max-w-md otherwise — and the ui sheet's own row type, so it reads as
// one app. Read-only: the two lines (no staff yet; recording opens once a
// staff is assigned) and nothing else (no dead-end buttons). A staff-less
// booking is not a recording target, so this sheet has no record row.

import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@synqed-kk/ui'
import type { ReservationView } from '@/lib/adapters/reservation-view'

interface UnassignedBookingSheetProps {
  /** The staff-less booking — `null` keeps the sheet closed. */
  booking: ReservationView | null
  isMobile: boolean
  onClose: () => void
}

export function UnassignedBookingSheet({
  booking,
  isMobile,
  onClose,
}: UnassignedBookingSheetProps) {
  const t = useTranslations('reservation')
  const tu = useTranslations('unassignedStaff')

  const open = booking !== null
  const onOpenChange = (next: boolean) => {
    if (!next) onClose()
  }

  const title = booking ? `${booking.customerName}${t('card.customerSuffix')}` : ''
  const subtitle = tu('sheetSubtitleReadOnly')
  const body = (
    <div className="pt-2 text-[12px] text-[var(--color-text-muted)]">{tu('recordBlockedReadOnly')}</div>
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle className="text-[17px]">{title}</SheetTitle>
            <SheetDescription>{subtitle}</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{subtitle}</DialogDescription>
        {body}
      </DialogContent>
    </Dialog>
  )
}
