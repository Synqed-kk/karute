'use client'

import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { createQuickCustomer } from '@/actions/customers'
import type { CustomerOption } from './CustomerCombobox'

type QuickCreateCustomerProps = {
  /** Called after successful customer creation with the new customer object */
  onCreated: (customer: CustomerOption) => void
  /** Called when user dismisses the quick-create form without creating */
  onCancel: () => void
}

/**
 * Inline quick-create form for adding a customer from within the save flow.
 *
 * Intentionally minimal: name-only input + create button.
 * On success, calls onCreated so the parent can immediately select the new customer.
 * On cancel (Escape or Cancel button), calls onCancel so the parent can show the combobox again.
 */
export function QuickCreateCustomer({ onCreated, onCancel }: QuickCreateCustomerProps) {
  const [name, setName] = useState('')
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
      setError('Name is required')
      return
    }

    setIsPending(true)
    try {
      const result = await createQuickCustomer(trimmed)
      if (result.success) {
        onCreated({ id: result.id, name: result.name })
      } else {
        setError(result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error')
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
          placeholder="Customer name"
          disabled={isPending}
          maxLength={100}
          aria-label="New customer name"
          aria-invalid={!!error}
          aria-describedby={error ? 'quick-create-error' : undefined}
        />
        <Button type="submit" disabled={isPending || !name.trim()} size="default">
          {isPending ? 'Creating...' : 'Create'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
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
