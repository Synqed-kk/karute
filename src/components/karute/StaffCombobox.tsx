'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type StaffComboboxOption = {
  id: string
  name: string
  /** 経営メンバー — kept OUT of the default list, revealed by typing. */
  isManagement?: boolean
}

type StaffComboboxProps = {
  /** The FULL store-scoped roster. Never pre-filter for 経営メンバー — this
   *  component owns that hiding, and selection resolves from this array. */
  staff: StaffComboboxOption[]
  selectedId: string | null
  /** '' when the clearable variant's 指名なし row is picked. */
  onSelect: (id: string) => void
  /** The viewer's own staff id. ALWAYS listed, flagged or not — a management
   *  member must be able to book themselves, and a picker that silently drops
   *  the seeded id files bookings under an identity it never showed. */
  selfId?: string | null
  /** Renders the pinned 指名なし row (顧客's 指名スタッフ). Omit where a staff
   *  is required (新規予約 / 新規カルテ): blur then reverts to the last valid
   *  selection instead. */
  noneLabel?: string
  placeholder?: string
  disabled?: boolean
  /** Forwarded to the input so an external <label htmlFor> still binds. */
  id?: string
}

/**
 * Searchable staff picker — the 担当/指名 assignment control on 新規予約,
 * 顧客フォーム and 新規カルテ.
 *
 * Same idiom as CustomerCombobox (input + dropdown, no cmdk/radix), with two
 * deliberate divergences, both council-settled:
 *   - it opens on FOCUS with the default list. CustomerCombobox's type-first
 *     rule exists because a salon has thousands of customers; a roster is a
 *     handful of people, and dumping it is the faster interaction.
 *   - the default list hides 経営メンバー. Typing searches the WHOLE roster,
 *     so they stay fully assignable — they just don't clutter the everyday
 *     list. Revealed entries carry the soft 経営 chip.
 *
 * Selection resolves from the FULL `staff` array, never the rendered list, so
 * an already-assigned management member (or a stylist who has since left the
 * store roster and was merged back in by the caller) never blanks out.
 */
export function StaffCombobox({
  staff,
  selectedId,
  onSelect,
  selfId,
  noneLabel,
  placeholder,
  disabled = false,
  id,
}: StaffComboboxProps) {
  const t = useTranslations('staff')
  const tc = useTranslations('common')
  const selected = staff.find((s) => s.id === selectedId) ?? null
  // Depend on the NAME, never the row object. Every call site builds its
  // `staff` array inline, so `selected` is a fresh identity on every parent
  // render — an effect keyed on the object re-runs on renders that changed
  // nothing and overwrites whatever the user is mid-way through typing. This
  // is the same hazard NewBookingDialog documents at :116-145.
  const selectedName = selected?.name ?? ''

  const [query, setQuery] = useState(selectedName)
  // Has the user actually EDITED the box? The input is pre-filled with the
  // current selection's name, so the raw text is not evidence of a search: on a
  // pristine open it is just the value being displayed. Treating it as a query
  // filtered the list down to the one person already chosen and hid the pinned
  // 指名なし row — i.e. opening the picker showed you only what you already
  // had. Dropdown behaviour matches the <select> it replaced: open = every
  // option. Filtering and the 経営メンバー reveal begin at the first keystroke.
  const [dirty, setDirty] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  /** Back to displaying the selection: blur, outside tap, or a pick. */
  function revert(name: string) {
    setQuery(name)
    setDirty(false)
  }

  // Track the selection from outside (dialog re-seed, quick-create, form
  // reset). Cleared selection empties the box rather than leaving a stale name
  // over an empty value.
  useEffect(() => {
    revert(selectedName)
  }, [selectedName])

  // pointerdown (not mousedown) so an outside tap also closes this on iOS
  // Safari — same reason CustomerCombobox uses it.
  useEffect(() => {
    function handleClickOutside(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
        revert(selectedName)
      }
    }
    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [selectedName])

  // '' until they type — see `dirty`.
  const trimmedQuery = dirty ? query.trim() : ''
  // Typing searches the whole roster INCLUDING management members (that is the
  // reveal); an untouched box shows the everyday list plus whoever must always
  // be there — the viewer themselves and the current selection.
  const visible = trimmedQuery
    ? staff.filter((s) => s.name.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : staff.filter(
        (s) => !s.isManagement || s.id === selfId || s.id === selectedId,
      )

  function handleSelect(option: StaffComboboxOption) {
    onSelect(option.id)
    revert(option.name)
    setOpen(false)
  }

  function handleSelectNone() {
    onSelect('')
    revert('')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <Input
        id={id}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setDirty(true)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false)
          // Revert whatever was half-typed: the value only ever changes by
          // picking a row.
          revert(selectedName)
        }}
        placeholder={placeholder ?? t('selectStaff')}
        disabled={disabled}
        autoComplete="off"
        aria-expanded={open && !disabled}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        role="combobox"
      />

      {open && !disabled && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-md"
        >
          {/* Pinned only on the DEFAULT list (mock §④). Once they start
           *  typing the list is a search result, and 指名なし is not something
           *  the query matched — leaving it pinned above the hits reads as a
           *  result that ignored what they typed. */}
          {noneLabel !== undefined && !trimmedQuery && (
            <>
              <button
                type="button"
                role="option"
                aria-selected={!selectedId}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSelectNone()
                }}
                className={cn(
                  'flex w-full cursor-pointer items-center px-3 py-2 text-sm text-muted-foreground hover:bg-muted',
                  !selectedId && 'bg-muted font-medium',
                )}
              >
                {noneLabel}
              </button>
              <div className="border-t border-border" />
            </>
          )}
          {/* 35dvh cap: the Android keyboard shrinks dvh, so the list adapts to
           *  the room actually left instead of clipping inside it. */}
          <ul className="max-h-[min(15rem,35dvh)] overflow-y-auto py-1">
            {visible.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                {tc('noResults')}
              </li>
            ) : (
              visible.map((option) => (
                <li
                  key={option.id}
                  role="option"
                  aria-selected={option.id === selectedId}
                  onMouseDown={(e) => {
                    // Land the pick before the input's blur closes the list.
                    e.preventDefault()
                    handleSelect(option)
                  }}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted',
                    option.id === selectedId && 'bg-muted font-medium',
                  )}
                >
                  <span>{option.name}</span>
                  {option.isManagement && (
                    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-blue-50 px-1.5 text-[10px] font-medium text-blue-800 ring-1 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20">
                      {t('managementBadge')}
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
