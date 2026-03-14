'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { CustomerForm } from '@/components/customers/CustomerForm'

export function CustomerSheet() {
  const t = useTranslations('customers')
  const [open, setOpen] = useState(false)

  function handleSuccess() {
    setOpen(false)
    toast.success(t('toast.created'))
    // List auto-refreshes via revalidatePath('/customers') in createCustomer action
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button>
            {t('newCustomer')}
          </Button>
        }
      />
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('form.create')}</SheetTitle>
          <SheetDescription className="sr-only">
            {t('form.create')}
          </SheetDescription>
        </SheetHeader>
        <div className="p-4 pt-2">
          <CustomerForm
            onSuccess={handleSuccess}
            onCancel={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
