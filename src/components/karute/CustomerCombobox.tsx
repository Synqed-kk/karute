'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type CustomerOption = {
  id: string
  name: string
  furigana?: string | null
  phone?: string | null
}

type CustomerComboboxProps = {
  customers: CustomerOption[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreateNew: (query?: string) => void
  placeholder?: string
  disabled?: boolean
}

const MAX_RESULTS = 8

/** Strip separators so "080-1234-5678" and "08012345678" match the same way.
 *  Full-width digits (０-９, the kana keyboard's default) fold to half-width
 *  first so phone search works without switching keyboards. */
function digitsOnly(s: string): string {
  return s
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[-\s－]/g, '')
}

/**
 * Searchable customer combobox with inline "+ New customer" option.
 *
 * Uses a simple input+dropdown pattern (no cmdk/radix required).
 * The dropdown ONLY renders once the staff has typed something — it
 * never dumps the full customer list on mere focus (that was both slow
 * and useless past a handful of customers). Matches by name, furigana,
 * or phone digits (dashes/spaces ignored on both sides).
 * Selecting a customer closes the dropdown and calls onSelect.
 * Clicking "+ New customer" calls onCreateNew(query) so the caller can
 * show QuickCreateCustomer inline, seeded with whatever was typed.
 */
export function CustomerCombobox({
  customers,
  selectedId,
  onSelect,
  onCreateNew,
  placeholder,
  disabled = false,
}: CustomerComboboxProps) {
  const t = useTranslations('customers')
  const selectedCustomer = customers.find((c) => c.id === selectedId) ?? null

  const [query, setQuery] = useState(selectedCustomer?.name ?? '')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync query when selection changes externally (e.g. after quick-create).
  // The else-branch clears the text on external DESELECT (selectedId → null,
  // e.g. a dialog re-seeding on reopen) — without it the input keeps showing
  // the previous customer's name while the real selection is empty, which
  // reads as a filled-in form with an inexplicably dead save button.
  useEffect(() => {
    if (selectedCustomer) {
      setQuery(selectedCustomer.name)
    } else {
      setQuery('')
    }
  }, [selectedCustomer])

  // Close dropdown when interacting outside — pointerdown (not mousedown) so
  // this also fires on iOS Safari, where a keyboard-dismiss tap outside the
  // input doesn't reliably generate a mousedown event.
  useEffect(() => {
    function handleClickOutside(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
        // Restore the selected customer name if user typed without selecting
        setQuery(selectedCustomer?.name ?? '')
      }
    }
    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [selectedCustomer])

  const trimmedQuery = query.trim()
  const queryDigits = digitsOnly(trimmedQuery)
  const isPhoneQuery = queryDigits.length >= 2 && /^\d+$/.test(queryDigits)
  const filtered = customers
    .filter((c) => {
      const q = trimmedQuery.toLowerCase()
      if (c.name.toLowerCase().includes(q)) return true
      if (c.furigana && c.furigana.toLowerCase().includes(q)) return true
      if (isPhoneQuery && c.phone && digitsOnly(c.phone).includes(queryDigits)) return true
      return false
    })
    .slice(0, MAX_RESULTS)

  function handleSelect(customer: CustomerOption) {
    onSelect(customer.id)
    setQuery(customer.name)
    setOpen(false)
  }

  function handleInputChange(value: string) {
    setQuery(value)
    setOpen(value.trim().length > 0)
  }

  function handleInputFocus(e: React.FocusEvent<HTMLInputElement>) {
    // Select-all instead of opening/clearing: typing immediately replaces
    // the current name rather than dumping the whole customer list.
    e.target.select()
  }

  function handleInputBlur() {
    setOpen(false)
    setQuery(selectedCustomer?.name ?? '')
  }

  function handleCreateNew() {
    setOpen(false)
    onCreateNew(trimmedQuery || undefined)
  }

  const showDropdown = open && !disabled && trimmedQuery.length > 0

  return (
    <div ref={containerRef} className="relative w-full">
      <Input
        type="text"
        value={query}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={handleInputFocus}
        onBlur={handleInputBlur}
        placeholder={placeholder ?? t('search.placeholder')}
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
          {/* 35dvh cap: on Android the keyboard shrinks dvh, so the list
           *  adapts to the room actually left instead of clipping at a
           *  fixed 240px inside the keyboard-shrunk dialog. */}
          <ul className="max-h-[min(15rem,35dvh)] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                {t('table.noResults')}
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
                    'flex cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-muted',
                    customer.id === selectedId && 'bg-muted font-medium',
                  )}
                >
                  <span>{customer.name}</span>
                  {customer.phone && (
                    <span className="text-xs text-muted-foreground">{customer.phone}</span>
                  )}
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
            {t('newCustomer')}
          </button>
        </div>
      )}
    </div>
  )
}
