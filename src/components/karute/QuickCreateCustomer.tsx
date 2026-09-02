'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { createQuickCustomer } from '@/actions/customers'
import type { CustomerOption } from './CustomerCombobox'

type QuickCreateCustomerProps = {
  /** Called after successful customer creation with the new customer object */
  onCreated: (customer: CustomerOption) => void
  /** Called when user dismisses the quick-create form without creating */
  onCancel: () => void
  /** Seeds the name input — e.g. whatever the staff had already typed into
   *  the combobox before tapping "+ 新規顧客". */
  initialName?: string
}

/**
 * Inline quick-create form for adding a customer from within the save flow.
 *
 * Intentionally minimal: name-only input + create button.
 * On success, calls onCreated so the parent can immediately select the new customer.
 * On cancel (Escape or Cancel button), calls onCancel so the parent can show the combobox again.
 */
export function QuickCreateCustomer({ onCreated, onCancel, initialName }: QuickCreateCustomerProps) {
  const t = useTranslations('customers')
  const [name, setName] = useState(initialName ?? '')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the name input when the form appears
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('form.name') + ' is required')
      return
    }

    setIsPending(true)
    try {
      const result = await createQuickCustomer(trimmed)
      if (result.success) {
        onCreated({ id: result.id, name: result.name })
      } else {
        // `|| t('toast.error')` matches CustomerForm: a failure with no
        // message of its own (the thin port's transport catch answers with an
        // empty one — it has no i18n) must still SAY something, and in the
        // staff's own language. Without the fallback an empty string is falsy,
        // so the <p role="alert"> below never renders and the save fails
        // silently — the class #810 exists to end.
        setError(result.error || t('toast.error'))
      }
    } catch {
      // Unexpected/infra failures (incl. the thin shell's not-wired action
      // stub) get the translated generic — never a raw internal message.
      // Expected validation errors arrive via result.error above.
      setError(t('toast.error'))
    } finally {
      setIsPending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2" onKeyDown={handleKeyDown}>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('form.namePlaceholder')}
          disabled={isPending}
          maxLength={100}
          aria-label={t('form.name')}
          aria-invalid={!!error}
          aria-describedby={error ? 'quick-create-error' : undefined}
        />
        <Button type="submit" disabled={isPending || !name.trim()} size="default">
          {isPending ? t('form.saving') : t('form.create')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
          {t('form.cancel')}
        </Button>
      </div>
      {error && (
        <p id="quick-create-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
