'use client'

// Wraps the existing CustomerForm in a Dialog for the "Edit
// customer" pencil button on the identity card. The form's edit
// path already exists (passes customerId + defaultValues, calls
// updateCustomer on submit) — this dialog just provides the
// trigger surface + modal chrome.

import type { StaffComboboxOption } from '@/components/karute/StaffCombobox'
import { useState } from 'react'
import { Pencil } from 'lucide-react'
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
import { CustomerForm } from '@/components/customers/CustomerForm'
import type { CustomerProfileData } from '../types'

interface Props {
  customer: CustomerProfileData
  /** Optional pre-loaded staff roster (thin app threads it from the screen
   *  DTO); omitted on web → CustomerForm self-fetches. */
  assignableStaff?: StaffComboboxOption[]
}

export function CustomerEditDialog({ customer, assignableStaff }: Props) {
  const t = useTranslations('customers.profile')
  const tCustomers = useTranslations('customers')
  const [open, setOpen] = useState(false)

  function handleSuccess() {
    setOpen(false)
    toast.success(tCustomers('toast.updated'))
    // Anthony's updateCustomer action calls revalidatePath('/customers')
    // and revalidatePath(`/customers/${id}`) — server re-renders push
    // the updated customer through, no client refetch needed here.
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('edit')}
          >
            <Pencil size={13} />
            <span className="hidden sm:inline">{t('edit')}</span>
          </button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editDialogTitle')}</DialogTitle>
          <DialogDescription>{t('editDialogDescription')}</DialogDescription>
        </DialogHeader>
        <CustomerForm
          customerId={customer.id}
          defaultValues={{
            name: customer.name,
            phone: customer.phone ?? '',
            email: customer.email ?? '',
            assignedStaffId: customer.preferredStaffId ?? '',
            dateOfBirth: customer.dateOfBirth ?? '',
            gender: customer.genderCode ?? '',
            occupation: customer.occupation ?? '',
            memberNumber: customer.memberNumber ?? '',
          }}
          currentStaff={
            customer.preferredStaffId
              ? {
                  id: customer.preferredStaffId,
                  name: customer.preferredStaffName ?? '—',
                }
              : null
          }
          assignableStaff={assignableStaff}
          onSuccess={handleSuccess}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
