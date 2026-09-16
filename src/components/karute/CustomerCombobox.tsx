'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { foldSearchDigits } from '@/lib/customers/karute-number-match'

export type CustomerOption = {
  id: string
  name: string
  furigana?: string | null
  phone?: string | null
}

/** A remote (company-wide) search result — same shape as a local row plus the
 *  honest 他店舗 label (⚖ Liam 2026-09-16, P3 cross-branch search). */
export type CustomerSearchOption = CustomerOption & { other_store: boolean }

/**
 * Shared debounced remote-search tier (P3): local filtering over the
 * preloaded store-lensed `customers` prop always runs first and instantly;
 * this ADDS a company-wide lookup once the query is long/specific enough to
 * be worth a round trip. Used by CustomerCombobox itself and by
 * RecordCustomerPickerDialog, which renders its own list but wants the exact
 * same remote tier — ONE place decides when to fire and how to debounce.
 */
export function useRemoteCustomerSearch(
  query: string,
  search: ((query: string) => Promise<{ options: CustomerSearchOption[] } | { error: string }>) | undefined,
): CustomerSearchOption[] {
  const [results, setResults] = useState<CustomerSearchOption[]>([])
  useEffect(() => {
    const trimmed = query.trim()
    const digits = foldSearchDigits(trimmed)
    const eligible = !!search && (trimmed.length >= 2 || (digits.length > 0 && /^\d+$/.test(digits)))
    if (!eligible) {
      setResults([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      search!(trimmed).then((res) => {
        if (!cancelled) setResults('options' in res ? res.options : [])
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, search])
  return results
}

type CustomerComboboxProps = {
  customers: CustomerOption[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreateNew: (query?: string) => void
  placeholder?: string
  disabled?: boolean
  /** Opt-in company-wide search (P3) — omitted, the combobox stays local-only
   *  exactly as before (ReassignCustomerAction/ReviewScreen/NewKaruteDialog
   *  never pass this; only NewBookingDialog does). */
  onRemoteSearch?: (query: string) => Promise<{ options: CustomerSearchOption[] } | { error: string }>
}

/** Rows one customer search shows at once. Exported because a caller that caps
 *  the list also has to tell the staff how many matches it left off — a header
 *  reading the capped array announces 8 matches over a salon of 20 (C-3). */
export const CUSTOMER_SEARCH_LIMIT = 8

// digitsOnly moved to karute-number-match.ts as foldSearchDigits (imported
// above) — the karute-number search needs the exact same fold, so there is
// now one canonical version instead of two that could drift apart.
const digitsOnly = foldSearchDigits

/**
 * THE customer-search rule — name, furigana, or phone digits (separators
 * ignored on both sides). Exported so the 録音 picker dialog searches exactly
 * the way this combobox does; a second hand-rolled filter is how two search
 * boxes in one app start disagreeing about what "たか" matches.
 */
export function filterCustomers<T extends CustomerOption>(
  customers: T[],
  query: string,
  limit = CUSTOMER_SEARCH_LIMIT,
): T[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const q = trimmed.toLowerCase()
  const queryDigits = digitsOnly(trimmed)
  const isPhoneQuery = queryDigits.length >= 2 && /^\d+$/.test(queryDigits)
  return customers
    .filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true
      if (c.furigana && c.furigana.toLowerCase().includes(q)) return true
      if (isPhoneQuery && c.phone && digitsOnly(c.phone).includes(queryDigits)) return true
      return false
    })
    .slice(0, limit)
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
  onRemoteSearch,
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
  const filtered = filterCustomers(customers, trimmedQuery)
  // Remote tier (P3): local rows always win a dupe — a remote hit already
  // offered locally is dropped, never shown twice.
  const localIds = new Set(filtered.map((c) => c.id))
  const remote = useRemoteCustomerSearch(trimmedQuery, onRemoteSearch)
  const remoteRows = remote.filter((r) => !localIds.has(r.id))

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
            {filtered.length === 0 && remoteRows.length === 0 ? (
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
            {/* Remote tier (P3, ⚖ Liam 2026-09-16): company-wide rows the local
             *  preloaded list doesn't have, appended below with a 他店舗 chip —
             *  honest labelling, never mixed into the local rows above. */}
            {remoteRows.length > 0 && (
              <>
                <li className="px-3 py-1 text-[11px] font-semibold text-muted-foreground" aria-hidden>
                  {t('otherStoreSection')}
                </li>
                {remoteRows.map((customer) => (
                  <li
                    key={customer.id}
                    role="option"
                    aria-selected={customer.id === selectedId}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleSelect(customer)
                    }}
                    className={cn(
                      'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted',
                      customer.id === selectedId && 'bg-muted font-medium',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      {customer.name}
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t('otherStoreChip')}
                      </span>
                    </span>
                    {customer.phone && (
                      <span className="text-xs text-muted-foreground">{customer.phone}</span>
                    )}
                  </li>
                ))}
              </>
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
