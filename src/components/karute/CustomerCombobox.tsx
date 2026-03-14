'use client'

import { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type CustomerOption = {
  id: string
  name: string
}

type CustomerComboboxProps = {
  customers: CustomerOption[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreateNew: () => void
  placeholder?: string
  disabled?: boolean
}

/**
 * Searchable customer combobox with inline "+ New customer" option.
 *
 * Uses a simple input+dropdown pattern (no cmdk/radix required).
 * The dropdown filters customers by name as the user types.
 * Selecting a customer closes the dropdown and calls onSelect.
 * Clicking "+ New customer" calls onCreateNew so the caller can
 * show QuickCreateCustomer inline.
 */
export function CustomerCombobox({
  customers,
  selectedId,
  onSelect,
  onCreateNew,
  placeholder = 'Search customers...',
  disabled = false,
}: CustomerComboboxProps) {
  const selectedCustomer = customers.find((c) => c.id === selectedId) ?? null

  const [query, setQuery] = useState(selectedCustomer?.name ?? '')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync query when selection changes externally (e.g. after quick-create)
  useEffect(() => {
    if (selectedCustomer) {
      setQuery(selectedCustomer.name)
    }
  }, [selectedCustomer])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
        // Restore the selected customer name if user typed without selecting
        setQuery(selectedCustomer?.name ?? '')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [selectedCustomer])

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase()),
  )

  function handleSelect(customer: CustomerOption) {
    onSelect(customer.id)
    setQuery(customer.name)
    setOpen(false)
  }

  function handleInputChange(value: string) {
    setQuery(value)
    setOpen(true)
  }

  function handleInputFocus() {
    setOpen(true)
    // Clear query to show all options when focusing with a selection
    if (selectedCustomer) {
      setQuery('')
    }
  }

  function handleCreateNew() {
    setOpen(false)
    onCreateNew()
  }

  const showDropdown = open && !disabled

  return (
    <div ref={containerRef} className="relative w-full">
      <Input
        type="text"
        value={query}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={handleInputFocus}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        aria-expanded={showDropdown}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        role="combobox"
      />

      {showDropdown && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-md"
        >
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 && query.trim().length > 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                No customers found
              </li>
            ) : (
              filtered.map((customer) => (
                <li
                  key={customer.id}
                  role="option"
                  aria-selected={customer.id === selectedId}
                  onMouseDown={(e) => {
                    // Prevent input blur before selection registers
                    e.preventDefault()
                    handleSelect(customer)
                  }}
                  className={cn(
                    'cursor-pointer px-3 py-2 text-sm hover:bg-muted',
                    customer.id === selectedId && 'bg-muted font-medium',
                  )}
                >
                  {customer.name}
                </li>
              ))
            )}
          </ul>

          {/* Divider before create option */}
          <div className="border-t border-border" />
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              handleCreateNew()
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-muted"
          >
            <span aria-hidden="true">+</span>
            New customer
          </button>
        </div>
      )}
    </div>
  )
}
