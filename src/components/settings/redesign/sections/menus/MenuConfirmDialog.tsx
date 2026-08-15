'use client'

// One confirm body for every menu confirm (停止 / 再開 / 全店舗に変更) —
// mocks ② and ②b are the same card: title, one plain-language paragraph,
// キャンセル + the commit button. CancelConfirmDialog.tsx is the shape
// precedent; the copy is props here because the three callers differ in
// nothing else.
//
// All three actions are REVERSIBLE (retire ⇄ reactivate, store scope is one
// edit away), so the commit button is the solid accent — never destructive
// red, which would read as "this is permanent" (mock ② law).

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

interface MenuConfirmDialogProps {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  /** The write is in flight — both buttons go inert (no double-submit). */
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function MenuConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
}: MenuConfirmDialogProps) {
  const t = useTranslations('settings.menus.form')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
