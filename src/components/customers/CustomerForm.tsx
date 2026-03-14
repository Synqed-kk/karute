'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createCustomer, updateCustomer } from '@/actions/customers'

// ---------------------------------------------------------------------------
// Schema (mirrors server-side schema — kept local for client-side validation)
// ---------------------------------------------------------------------------

const CustomerFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  furigana: z.string().max(100).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
})

export type CustomerFormValues = z.infer<typeof CustomerFormSchema>

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CustomerFormProps {
  customerId?: string
  defaultValues?: Partial<CustomerFormValues>
  onSuccess?: () => void
  onCancel?: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CustomerForm({
  customerId,
  defaultValues,
  onSuccess,
  onCancel,
}: CustomerFormProps) {
  const t = useTranslations('customers')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(CustomerFormSchema),
    defaultValues: {
      name: '',
      furigana: '',
      phone: '',
      email: '',
      ...defaultValues,
    },
  })

  async function onSubmit(values: CustomerFormValues) {
    const result = customerId
      ? await updateCustomer(customerId, values)
      : await createCustomer(values)

    if (!result.success) {
      toast.error(result.error || t('toast.error'))
      return
    }

    // Duplicate warning — customer was still saved, just warn
    if (result.duplicateWarning) {
      toast.warning(result.duplicateWarning)
    }

    onSuccess?.()
  }

  function handleCancel() {
    reset()
    onCancel?.()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {/* Name (required) */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">
          {t('form.name')}
          <span className="ml-0.5 text-destructive">*</span>
        </label>
        <Input
          type="text"
          placeholder={t('form.namePlaceholder')}
          aria-invalid={!!errors.name}
          {...register('name')}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      {/* Furigana (optional) */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">{t('form.furigana')}</label>
        <Input
          type="text"
          placeholder={t('form.furiganaPlaceholder')}
          {...register('furigana')}
        />
      </div>

      {/* Phone (optional) */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">{t('form.phone')}</label>
        <Input
          type="tel"
          placeholder={t('form.phonePlaceholder')}
          {...register('phone')}
        />
      </div>

      {/* Email (optional) */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">{t('form.email')}</label>
        <Input
          type="email"
          placeholder={t('form.emailPlaceholder')}
          aria-invalid={!!errors.email}
          {...register('email')}
        />
        {errors.email && (
          <p className="text-xs text-destructive">{errors.email.message}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={handleCancel}>
          {t('form.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('form.saving') : t('form.create')}
        </Button>
      </div>
    </form>
  )
}
