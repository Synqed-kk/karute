'use client'

// ─────────────────────────────────────────────────────────────
// CancelConfirmDialog — final confirmation before cancellation
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: inline in SubscriptionSettings.tsx.
// Dangerous-action dialog with explicit consequence bullets so
// the owner sees exactly what happens before they confirm.
//
// ANTHONY: in prod the confirm calls
//   stripe.subscriptions.update(subId, { cancel_at_period_end: true })
// Owner keeps full access until current period ends; on the
// next webhook event the local subscription flips to canceled.

import { AlertCircle } from 'lucide-react'
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

interface CancelConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}

export function CancelConfirmDialog({
  open,
  onClose,
  onConfirm,
}: CancelConfirmDialogProps) {
  const t = useTranslations('settings.subscription.cancel')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300">
            <AlertCircle className="size-5" aria-hidden />
          </div>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogBody')}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 pl-1 text-[12px] text-foreground/85">
          <li className="flex items-start gap-2">
            <span className="text-muted-foreground">•</span>
            <span>{t('point1')}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-muted-foreground">•</span>
            <span>{t('point2')}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-muted-foreground">•</span>
            <span>{t('point3')}</span>
          </li>
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('keepSubscription')}
          </Button>
          <Button
            onClick={onConfirm}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {t('confirmCancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
