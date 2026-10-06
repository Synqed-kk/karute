'use client'

// 担当未定 (PR-B Q2): the sheet a booking with NO staff opens instead of the
// @synqed-kk/ui BookingActionSheet, which has no slot for a staff picker and
// always renders a record row (a staff-less booking is not a recording
// target). Same primitives as the ui sheet — Sheet side="bottom" on a phone,
// Dialog max-w-md otherwise — and the ui sheet's own row type, so it reads as
// one app. With bookings.manage: the picker, committing on tap. Without: the
// two read-only lines and nothing else (no dead-end buttons).
//
// One component, two transports: `updateAppointment` is the web server
// action; the thin shell's alias maps it to POST …/assign-staff.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
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
import { useRouter } from '@/i18n/navigation'
import { updateAppointment } from '@/actions/appointments'
import type { ReservationView } from '@/lib/adapters/reservation-view'

export interface AssignableStaff {
  id: string
  name: string
}

interface UnassignedBookingSheetProps {
  /** The staff-less booking — `null` keeps the sheet closed. */
  booking: ReservationView | null
  canAssign: boolean
  staff: readonly AssignableStaff[]
  isMobile: boolean
  onClose: () => void
}

export function UnassignedBookingSheet({
  booking,
  canAssign,
  staff,
  isMobile,
  onClose,
}: UnassignedBookingSheetProps) {
  const t = useTranslations('reservation')
  const tu = useTranslations('unassignedStaff')
  const tc = useTranslations('common')
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const open = booking !== null
  const onOpenChange = (next: boolean) => {
    if (!next && pendingId === null) onClose()
  }

  async function assign(member: AssignableStaff) {
    if (!booking || pendingId !== null) return
    setPendingId(member.id)
    const res = await updateAppointment(booking.id, { staffProfileId: member.id })
    setPendingId(null)
    if ('error' in res) {
      toast.error(tc('somethingWentWrong'))
      return
    }
    toast.success(tu('assigned', { staff: member.name }))
    onClose()
    router.refresh()
  }

  const title = booking ? `${booking.customerName}${t('card.customerSuffix')}` : ''
  const subtitle = canAssign ? tu('sheetSubtitle') : tu('sheetSubtitleReadOnly')
  const body = canAssign ? (
    <div className="space-y-2 pt-2">
      <div>
        <div className="text-[15px] font-semibold text-[var(--color-text)]">{tu('pickerTitle')}</div>
        <div className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{tu('pickerLead')}</div>
      </div>
      <ul className="space-y-2">
        {staff.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              disabled={pendingId !== null}
              aria-busy={pendingId === m.id}
              onClick={() => void assign(m)}
              className="flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 text-left text-[15px] font-semibold text-[var(--color-text)] transition-colors active:bg-[var(--color-bg-card-hover)] disabled:opacity-60"
            >
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : (
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
