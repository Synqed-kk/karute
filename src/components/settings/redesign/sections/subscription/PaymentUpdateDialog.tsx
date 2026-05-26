'use client'

// ─────────────────────────────────────────────────────────────
// PaymentUpdateDialog — placeholder until Stripe Elements
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: inline in SubscriptionSettings.tsx.
// Scaffold stub — explains that Stripe Elements will render
// here in prod. UI safe to ship: shows the explanation and a
// close button.
//
// ANTHONY: in prod swap the explanation block for a
//   <Elements stripe={stripePromise}>
//     <CardElement />
//   </Elements>
// and call stripe.paymentMethods.attach() on the returned id.

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface PaymentUpdateDialogProps {
  open: boolean
  onClose: () => void
}

export function PaymentUpdateDialog({
  open,
  onClose,
}: PaymentUpdateDialogProps) {
  const t = useTranslations('settings.subscription.paymentUpdate')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-gray-50/80 p-4 text-[12px] leading-relaxed text-muted-foreground ring-1 ring-black/5 dark:bg-white/[0.03] dark:ring-white/10">
          {t('stripeElementsStub')}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t('gotIt')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
