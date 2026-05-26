'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createCustomer, updateCustomer } from '@/actions/customers'
import { formatJpPhone, formatJpPhoneProgressive } from '@/lib/format/phone'

// ---------------------------------------------------------------------------
// Schema — mirrors the server-side schema. Visible client-side fields that
// the server doesn't yet support (age, gender, preferredStaffId) live below
// as DISABLED inputs only; they're not part of the submitted shape so the
// existing server contract is unchanged.
// ---------------------------------------------------------------------------

function createCustomerFormSchema(messages: { nameRequired: string; invalidEmail: string }) {
  return z.object({
    // Split for UI symmetry with the design spike. Concatenated to `name`
    // at submit time (`${familyName} ${givenName}`.trim()) so the server
    // schema, which expects a single `name`, doesn't have to change.
    // familyName is the only required field — matches the spike, which
    // treats given name as optional.
    familyName: z.string().min(1, messages.nameRequired).max(100),
    givenName: z.string().max(100).optional().or(z.literal('')),
    furigana: z.string().max(100).optional().or(z.literal('')),
    phone: z.string().max(20).optional().or(z.literal('')),
    email: z.string().email(messages.invalidEmail).optional().or(z.literal('')),
  })
}

type CustomerFormSchema = ReturnType<typeof createCustomerFormSchema>

export type CustomerFormValues = z.infer<CustomerFormSchema>

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CustomerFormProps {
  customerId?: string
  /**
   * Pre-populated values for edit mode. For backward compat with the
   * older single-`name` shape, `name` is split at the first space into
   * familyName / givenName.
   */
  defaultValues?: Partial<CustomerFormValues> & { name?: string }
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

  const schema = createCustomerFormSchema({
    nameRequired: t('form.nameRequired'),
    invalidEmail: t('form.invalidEmail'),
  })

  // Edit-mode backfill: split the stored single `name` field into 姓 / 名.
  // Defensive: the field separator is a single space (full-width or
  // half-width — we normalize). Names without a space land entirely
  // in familyName, which is the safer default for Japanese where the
  // family name is the more-significant identifier.
  const seededDefaults = (() => {
    if (!defaultValues) return undefined
    const { name, familyName, givenName, ...rest } = defaultValues
    if (familyName !== undefined || givenName !== undefined) {
      return { familyName: familyName ?? '', givenName: givenName ?? '', ...rest }
    }
    if (typeof name === 'string') {
      const normalized = name.replace(/　/g, ' ').trim()
      const idx = normalized.indexOf(' ')
      if (idx === -1) return { familyName: normalized, givenName: '', ...rest }
      return {
        familyName: normalized.slice(0, idx),
        givenName: normalized.slice(idx + 1),
        ...rest,
      }
    }
    return { ...rest }
  })()

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      familyName: '',
      givenName: '',
      furigana: '',
      phone: '',
      email: '',
      ...seededDefaults,
    },
  })

  async function onSubmit(values: CustomerFormValues) {
    // Concatenate into the single `name` field the server schema expects.
    const fullName = `${values.familyName.trim()} ${values.givenName?.trim() ?? ''}`.trim()
    const submitPayload = {
      name: fullName,
      furigana: values.furigana,
      phone: values.phone,
      email: values.email,
    }

    const result = customerId
      ? await updateCustomer(customerId, submitPayload)
      : await createCustomer(submitPayload)

    if (!result.success) {
      toast.error(result.error || t('toast.error'))
      return
    }

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
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3 pt-1">
      {/* 姓 / 名 — split for spike symmetry, concatenated on submit */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('form.familyName')} required error={errors.familyName?.message}>
          <Input
            type="text"
            placeholder={t('form.familyNamePlaceholder')}
            aria-invalid={!!errors.familyName}
            autoComplete="family-name"
            autoFocus
            {...register('familyName')}
          />
        </Field>
        <Field label={t('form.givenName')}>
          <Input
            type="text"
            placeholder={t('form.givenNamePlaceholder')}
            autoComplete="given-name"
            {...register('givenName')}
          />
        </Field>
      </div>

      {/* 年齢 / 性別 — visible-but-disabled stubs.
       *
       * ANTHONY: these need DB columns + a schema extension on
       * createCustomer / updateCustomer in src/actions/customers.ts
       * before they can be enabled. Suggested columns:
       *   age:    integer NULL
       *   gender: text NULL CHECK (gender IN ('female','male','other'))
       *
       * Once the schema's ready, drop `disabled` + the `comingSoon`
       * badges and wire {...register('age')} / {...register('gender')}.
       * The CustomerListRow already has `age` and `gender` typed as
       * `number|null` / `string|null` so the read path is ready. */}
      <div className="grid grid-cols-2 gap-3">
        <StubField label={t('form.age')}>
          <Input
            type="number"
            inputMode="numeric"
            placeholder={t('form.agePlaceholder')}
            min={0}
            max={120}
            disabled
          />
        </StubField>
        <StubField label={t('form.gender')}>
          <select
            disabled
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option>{t('form.female')}</option>
            <option>{t('form.male')}</option>
            <option>{t('form.other')}</option>
          </select>
        </StubField>
      </div>

      {/* 読み (ふりがな) — preserved from the previous form; lives below
       *  the name fields so it pairs visually with the name it's
       *  reading. Not in the spike but Anthony's schema has it and we
       *  shouldn't drop the data path. */}
      <Field label={t('form.furigana')}>
        <Input
          type="text"
          placeholder={t('form.furiganaPlaceholder')}
          {...register('furigana')}
        />
      </Field>

      {/* 電話番号 — LIVE auto-formats as the staff types.
       *  Dashes appear at the canonical 3-4-4 / 2-4-4 / 3-3-4 break
       *  points the moment the format is unambiguous, so the field
       *  never reads "08000000006" — it self-corrects to "080-0000-0006"
       *  as the digits land. Excess digits past 11 are dropped silently
       *  (longest JP shape is mobile 11-digit) so staff can't typo too
       *  many digits. Blur still runs a final pass via formatJpPhone in
       *  case the live formatter punted (e.g., on a leading "+81" paste
       *  the progressive version normalizes the same way). */}
      <Field label={t('form.phone')}>
        <Input
          type="tel"
          placeholder={t('form.phonePlaceholder')}
          autoComplete="tel"
          inputMode="numeric"
          maxLength={13}
          {...register('phone', {
            onChange: (e) => {
              const formatted = formatJpPhoneProgressive(e.target.value)
              if (formatted !== e.target.value) {
                setValue('phone', formatted, { shouldDirty: true })
              }
            },
            onBlur: (e) => {
              const formatted = formatJpPhone(e.target.value)
              if (formatted && formatted !== e.target.value) {
                setValue('phone', formatted, { shouldDirty: true })
              }
            },
          })}
        />
      </Field>

      {/* メールアドレス */}
      <Field label={t('form.email')} error={errors.email?.message}>
        <Input
          type="email"
          placeholder={t('form.emailPlaceholder')}
          aria-invalid={!!errors.email}
          autoComplete="email"
          {...register('email')}
        />
      </Field>

      {/* 指名スタッフ — visible-but-disabled stub.
       *
       * ANTHONY: the `customers.assigned_staff_id` column already
       * exists (you read it back via list-enrich), but
       * createCustomer's zod schema in src/actions/customers.ts
       * doesn't accept it on write. Add an optional UUID field there,
       * then drop `disabled` here and wire a real `<Select>` populated
       * from `getStaffList()`. Default option is "指名なし" (No
       * preference) → maps to null. */}
      <StubField label={t('form.preferredStaff')}>
        <select
          disabled
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option>{t('form.noPreference')}</option>
        </select>
      </StubField>

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

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/**
 * Visually-present, disabled stub field. Used for fields the design
 * calls for but whose underlying schema/action wiring is Anthony's to
 * land. The small "soon" pill next to the label makes the disabled
 * state legible at a glance (so users don't think the input is
 * broken).
 */
function StubField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  const t = useTranslations('customers.form')
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        {label}
        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
          {t('comingSoon')}
        </span>
      </label>
      {children}
    </div>
  )
}
