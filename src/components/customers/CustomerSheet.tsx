'use client'

import type { StaffComboboxOption } from '@/components/karute/StaffCombobox'
import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { UserPlus } from 'lucide-react'
import { CustomerForm } from '@/components/customers/CustomerForm'

interface CustomerSheetProps {
  /** Tenant staff roster for the 指名スタッフ picker — threaded straight
   *  through to CustomerForm (no fetch fallback there anymore). */
  assignableStaff?: StaffComboboxOption[]
}

/**
 * The add-customer circle → centered modal dialog for creating a new
 * customer. Previously a side-sliding Sheet; switched to Dialog to
 * mirror the design spike's `NewCustomerDialog` UX. File/export name
 * kept (`CustomerSheet`) to avoid churning callsites — the component
 * still owns the trigger + dialog wrapper, only the underlying
 * primitive changed.
 */
export function CustomerSheet({ assignableStaff }: CustomerSheetProps) {
  const t = useTranslations('customers')
  const [open, setOpen] = useState(false)

  function handleSuccess() {
    setOpen(false)
    toast.success(t('toast.created'))
    // List auto-refreshes via revalidatePath('/customers') in createCustomer action
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* ⚖ 顧客 TAB LOCKED 02:1x (Liam): the 「+ 新規顧客」 pill became the blue
       *  add-person circle at the end of the search row — the カルテ ＋
       *  circle's family (size icon-lg = 36px, primary, rounded-full, icon
       *  18px). The 「+ 新規顧客」 key stays as its accessible name. Same
       *  dialog as before. */}
      <DialogTrigger
        render={
          <Button size="icon-lg" className="rounded-full" aria-label={t('newCustomer')}>
            <UserPlus className="size-[18px]" aria-hidden />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('form.titleNew')}</DialogTitle>
          <DialogDescription>{t('form.description')}</DialogDescription>
        </DialogHeader>
        <CustomerForm
          assignableStaff={assignableStaff}
          onSuccess={handleSuccess}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
