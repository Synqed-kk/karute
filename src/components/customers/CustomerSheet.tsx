'use client'

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
import { CustomerForm } from '@/components/customers/CustomerForm'

/**
 * "+ 新規顧客" button → centered modal dialog for creating a new
 * customer. Previously a side-sliding Sheet; switched to Dialog to
 * mirror the design spike's `NewCustomerDialog` UX. File/export name
 * kept (`CustomerSheet`) to avoid churning callsites — the component
 * still owns the trigger + dialog wrapper, only the underlying
 * primitive changed.
 */
export function CustomerSheet() {
  const t = useTranslations('customers')
  const [open, setOpen] = useState(false)

  function handleSuccess() {
    setOpen(false)
    toast.success(t('toast.created'))
    // List auto-refreshes via revalidatePath('/customers') in createCustomer action
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            {t('newCustomer')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('form.titleNew')}</DialogTitle>
          <DialogDescription>{t('form.description')}</DialogDescription>
        </DialogHeader>
        <CustomerForm
          onSuccess={handleSuccess}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
