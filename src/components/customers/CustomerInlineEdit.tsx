'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updateCustomer } from '@/actions/customers'
import type { Customer } from '@/types/database'

// Same schema as customers.ts — imported pattern kept DRY inline
const CustomerFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  furigana: z.string().max(100).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
})

type CustomerFormValues = z.infer<typeof CustomerFormSchema>

interface CustomerInlineEditProps {
  customer: Customer
  onSave: () => void
  onCancel: () => void
}

export function CustomerInlineEdit({ customer, onSave, onCancel }: CustomerInlineEditProps) {
  const t = useTranslations('customers')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(CustomerFormSchema),
    defaultValues: {
      name: customer.name ?? '',
      furigana: customer.furigana ?? '',
      phone: customer.phone ?? '',
      email: customer.email ?? '',
    },
  })

  async function onSubmit(values: CustomerFormValues) {
    setIsSubmitting(true)
    try {
      const result = await updateCustomer(customer.id, values)
      if (result.success) {
        toast.success(t('toast.updated'))
        onSave()
      } else {
        toast.error(result.error || t('toast.error'))
      }
    } catch {
      toast.error(t('toast.error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleCancel() {
    reset()
    onCancel()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Name */}
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="edit-name">
            {t('form.name')} <span className="text-destructive">*</span>
          </label>
          <Input
            id="edit-name"
            placeholder={t('form.namePlaceholder')}
            aria-invalid={!!errors.name}
            {...register('name')}
          />
          {errors.name && (
            <p className="text-xs text-destructive">{errors.name.message}</p>
          )}
        </div>

        {/* Furigana */}
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="edit-furigana">
            {t('form.furigana')}
          </label>
          <Input
            id="edit-furigana"
            placeholder={t('form.furiganaPlaceholder')}
            {...register('furigana')}
          />
        </div>

        {/* Phone */}
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="edit-phone">
            {t('form.phone')}
          </label>
          <Input
            id="edit-phone"
            type="tel"
            placeholder={t('form.phonePlaceholder')}
            {...register('phone')}
          />
        </div>

        {/* Email */}
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="edit-email">
            {t('form.email')}
          </label>
          <Input
            id="edit-email"
            type="email"
            placeholder={t('form.emailPlaceholder')}
            aria-invalid={!!errors.email}
            {...register('email')}
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>
      </div>

      {/* Customer type + Notes */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="edit-type">Type</label>
          <select
            id="edit-type"
            defaultValue={(customer as { customer_type?: string }).customer_type ?? ''}
            onChange={async (e) => {
              await updateCustomer(customer.id, { customer_type: e.target.value || null } as Record<string, unknown>)
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">None</option>
            <option value="nominated">Nominated</option>
            <option value="walkin">Walk-in</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="edit-notes">Notes</label>
          <Input
            id="edit-notes"
            placeholder="Internal notes..."
            defaultValue={(customer as { notes?: string }).notes ?? ''}
            onBlur={async (e) => {
              await updateCustomer(customer.id, { notes: e.target.value } as Record<string, unknown>)
            }}
          />
        </div>
      </div>

      {/* Save and Cancel buttons */}
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={isSubmitting} size="sm">
          {isSubmitting ? t('form.saving') : t('profile.save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          {t('profile.cancel')}
        </Button>
      </div>
    </form>
  )
}
