'use client'

import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { CachedMenuOption } from '@/lib/menus/cached'

type MenuComboboxProps = {
  /** Pre-sorted active-menu union (category band → display order → name). */
  menus: CachedMenuOption[]
  value: string
  linkedMenuId: string | null
  /** A manual edit — the dialog drops the link on it (R8). */
  onTextChange: (text: string) => void
  onPick: (menu: CachedMenuOption) => void
  placeholder?: string
  /** Lets the chip's × hand focus back to the field. */
  inputRef?: React.RefObject<HTMLInputElement | null>
}

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`
}

/** Band menus (price_min_amount set) show the range; the chip that books
 *  always shows the list price. */
export function formatMenuPrice(
  menu: Pick<CachedMenuOption, 'price_list_amount' | 'price_min_amount'>,
): string {
  const list = formatYen(menu.price_list_amount)
  return menu.price_min_amount == null
    ? list
    : `${formatYen(menu.price_min_amount)}–${list}`
}

/**
 * Menu picker for the 予約 dialog's メニュー field.
 *
 * Deliberately NOT CustomerCombobox: that one snaps unmatched text back to the
 * selected customer, this one keeps free text as a first-class answer (a shop
 * books things that aren't in its catalog). It also opens on FOCUS with the
 * whole grouped catalog — a menu list is short and browsing it is the point,
 * where dumping every customer never was.
 *
 * The popover opens UPWARD: メニュー is the dialog's LAST field, so a downward
 * list would cover 保存 and turn a save tap into a silent menu swap.
 */
export function MenuCombobox({
  menus,
  value,
  linkedMenuId,
  onTextChange,
  onPick,
  placeholder,
  inputRef,
}: MenuComboboxProps) {
  const t = useTranslations('reservation')
  const listId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  // Opening shows the FULL catalog and only typing narrows it, so the filter
  // is its own state — not the field's text, which survives every close.
  const [filter, setFilter] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)

  const query = filter.trim().toLowerCase()
  const options = query
    ? menus.filter((m) => m.name.toLowerCase().includes(query))
    : menus

  // Never inherit the previous open's scroll position — the first category
  // has to be the first thing on screen.
  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = 0
  }, [open, filter])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      // jsdom has no scrollIntoView.
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex])

  // pointerdown (not mousedown) so an iOS tap outside closes the list too.
  // Closing never touches the text — free input is never snapped back.
  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  function openList() {
    setFilter('')
    setActiveIndex(-1)
    setOpen(true)
  }

  function pick(menu: CachedMenuOption) {
    onPick(menu)
    setFilter('')
    setActiveIndex(-1)
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (!open) return
      event.preventDefault()
      // The dialog around this field closes on Escape too. Dismissing the
      // list must not also throw away a half-entered booking, so this Escape
      // is consumed here; the next one (list closed) reaches the dialog.
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key === 'Enter') {
      const menu = open ? options[activeIndex] : undefined
      if (!menu) return
      event.preventDefault()
      pick(menu)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    if (!open) {
      openList()
      return
    }
    if (options.length === 0) return
    const step = event.key === 'ArrowDown' ? 1 : -1
    setActiveIndex((i) =>
      i < 0
        ? step === 1
          ? 0
          : options.length - 1
        : (i + step + options.length) % options.length,
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      onBlur={(e) => {
        if (containerRef.current?.contains(e.relatedTarget)) return
        setOpen(false)
      }}
    >
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onTextChange(e.target.value)
          setFilter(e.target.value)
          setActiveIndex(-1)
          setOpen(true)
        }}
        onFocus={openList}
        // Reopen after an Escape that never blurred the field.
        onClick={() => !open && openList()}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={
          activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined
        }
      />

      {open && (
        <div className="absolute bottom-full right-0 left-0 z-50 mb-1 rounded-lg border border-border bg-popover shadow-md">
          {/* 35dvh cap: the Android keyboard shrinks dvh, so the list takes
           *  the room actually left instead of clipping (CustomerCombobox). */}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={t('newBookingDialog.menuListLabel')}
            className="max-h-[min(15rem,35dvh)] overflow-y-auto py-1"
          >
            {options.length === 0 ? (
              <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">
                {t('newBookingDialog.menuNoResults')}
              </li>
            ) : (
              options.map((menu, i) => (
                <Fragment key={menu.id}>
                  {(i === 0 || options[i - 1].category !== menu.category) && (
                    <li
                      role="presentation"
                      className="px-3 pt-1.5 pb-1 text-xs text-muted-foreground"
                    >
                      {menu.category ?? t('newBookingDialog.menuUncategorized')}
                    </li>
                  )}
                  <li
                    id={`${listId}-opt-${i}`}
                    role="option"
                    aria-selected={menu.id === linkedMenuId}
                    data-active={i === activeIndex || undefined}
                    onMouseDown={(e) => {
                      // Prevent input blur before the pick registers
                      e.preventDefault()
                      pick(menu)
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      // No hover: classes — onMouseEnter sets activeIndex,
                      // so the pointer gets the same wash the keyboard does.
                      'flex cursor-pointer flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2 text-sm',
                      i === activeIndex && 'bg-primary/8 text-primary',
                    )}
                  >
                    <span>
                      <span className="font-medium">{menu.name}</span>
                      <span className="text-muted-foreground">
                        {` · ${t('card.duration', { n: menu.duration_minutes })} · ${formatMenuPrice(menu)}`}
                      </span>
                    </span>
                    {menu.storeName && (
                      <span className="rounded-full bg-muted px-1.5 py-px text-[11px] text-muted-foreground">
                        {menu.storeName}
                      </span>
                    )}
                  </li>
                </Fragment>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
