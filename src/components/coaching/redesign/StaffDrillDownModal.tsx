'use client'

// ─────────────────────────────────────────────────────────────
// StaffDrillDownModal — privacy disclosure before drill-down
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/StaffDrillDownModal.tsx
// (~96 lines). Behavior + copy preserved 1:1.
//
// Mobile → bottom sheet. Desktop → centered dialog.
// Always blocks the page on first visit; cancelling sends the
// owner back to /coaching (the table they came from).
//
// PURPOSE: makes the privacy posture concrete every time —
// the owner explicitly acknowledges they're entering a
// Layer 2-only view before any per-staff content paints.

import { useEffect, useState } from 'react'
import { Shield } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

/** Local hook — same pattern as BookingActionSheetWrapper.
 *  Inline so the modal is self-contained; if we end up with
 *  3+ call sites we can hoist to src/hooks/use-is-mobile.ts. */
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

interface StaffDrillDownModalProps {
  open: boolean
  staffName: string
  onConfirm: () => void
  onCancel: () => void
}

export function StaffDrillDownModal({
  open,
  staffName,
  onConfirm,
  onCancel,
}: StaffDrillDownModalProps) {
  const t = useTranslations('coaching.staffDrill.modal')
  const isMobile = useIsMobile()

  const title = t('title', { name: staffName })
  const description = t('description')

  const footer = (
    <>
      <Button
        variant="outline"
        onClick={onCancel}
        className="h-12 w-full md:h-10 md:w-auto"
      >
        {t('cancel')}
      </Button>
      <Button
        onClick={onConfirm}
        className="h-12 w-full bg-indigo-600 hover:bg-indigo-700 md:h-10 md:w-auto"
      >
        {t('confirm')}
      </Button>
    </>
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(v) => !v && onCancel()}>
        <SheetContent side="bottom">
          <SheetHeader>
            <div className="flex items-center gap-2">
              <Shield className="size-4 text-slate-500" aria-hidden />
              <SheetTitle className="text-[17px]">{title}</SheetTitle>
            </div>
            <SheetDescription className="pt-1 leading-relaxed">
              {description}
            </SheetDescription>
          </SheetHeader>
          <SheetFooter className="mt-4 flex-col gap-2 sm:flex-col">
            {footer}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-slate-500" aria-hidden />
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="pt-2 leading-relaxed">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="pt-2">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
