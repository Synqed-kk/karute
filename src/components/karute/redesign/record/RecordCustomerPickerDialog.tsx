'use client'

// ============================================================
// お客様を選んで録音 — picker dialog v2 (Liam-approved mock
// mock-a-dialog-v2.html, 8/19)
// ============================================================
// Opens from the no-own-booking card. It no longer starts as an empty search
// box: the day's bookings are listed the moment it opens, as COMPACT
// reservation-style rows built from the same primitives the 予約 agenda uses
// (BADGE_COLORS stripe · staff-colors avatar/dot · AppointmentCard's PackPill).
// Typing swaps the list for enriched search results over ALL customers.
//
// Two exits, deliberately different:
//   · booking row  → /sessions?appointmentId=  (binds THROUGH the booking, so
//                    the server re-resolves menu/consent/packs from it; a
//                    colleague's booking still lands on otherStaffBanner)
//   · search row   → /sessions?customerId=     (pre-existing, armor-pinned)
// A booking whose karute already exists is a greyed, NON-tappable 記録済 row —
// re-recording over a finished session is not an offer.
//
// A-1 is untouched: this dialog is the EXPLICIT path the staff opened. The
// legacy 別の予約を選択 sheet (SelectBookingSheet) is the auto-context picker
// the guarantee talks about and is still absent from every null-target state.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Search, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { BADGE_COLORS } from '@/lib/badge-styles'
import { getStaffColorByKey, type StaffColor } from '@/lib/staff-colors'
import { PackPill } from '@/components/reservation/AppointmentCard'
import { deriveFamilyInitials } from '@/lib/customers/identity'
import {
  filterCustomers,
  type CustomerOption,
} from '@/components/karute/CustomerCombobox'
import type { RecordTargetBooking } from './RecordingTargetCard'

/**
 * Per-customer display facts, server-derived (buildRecordScreen) from the same
 * bulk reads the 予約 agenda and 顧客 list use — so a 残5/6 here is the same
 * 残5/6 there.
 *
 * EVERY field but `id` is optional AND omitted when empty: absent = "nothing to
 * show", which is also exactly what an older payload (no facts at all) looks
 * like, so the rows degrade to name + time instead of rendering blanks.
 */
export interface RecordCustomerFact {
  id: string
  /** Sequential salon number, "#00058". */
  karuteNumber?: string
  /** First-ever visit — the isReturningCustomer chopstick's verdict, inverted. */
  isNew?: boolean
  /** At least one karute record on file (absent → カルテ未作成). */
  hasKarute?: boolean
  /** Live 回数券 usage → the 残n/m pill. */
  pack?: { remaining: number; size: number }
  /** 前回 visit date, pre-formatted server-side ("8月2日"). */
  lastVisitDate?: string
  /** What they last came in for. */
  lastVisitService?: string
  /** 担当 on their most relevant booking. */
  staffName?: string
  staffColorKey?: string
}

// The search box owns the results region (aria-controls) — the id lives on the
// wrapper so it resolves whether the region is a listbox or an empty-state line.
const LIST_ID = 'record-picker-results'

interface Props {
  customers: CustomerOption[]
  /** Today's store-day bookings (cancelled already excluded server-side). */
  bookings: RecordTargetBooking[]
  facts?: RecordCustomerFact[]
  onSelectBooking: (booking: RecordTargetBooking) => void
  onSelectCustomer: (customerId: string) => void
  onClose: () => void
  cancelLabel: string
}

export function RecordCustomerPickerDialog({
  customers,
  bookings,
  facts,
  onSelectBooking,
  onSelectCustomer,
  onClose,
  cancelLabel,
}: Props) {
  // 'recording' (not 'recording.target'): RecordPageView reads the same namespace,
  // and the dialog's aria-label is pinned as target.chooseCustomer by the armor test.
  const t = useTranslations('recording')
  const tc = useTranslations('common')
  const tCustomers = useTranslations('customers')
  const [query, setQuery] = useState('')

  // Move focus INTO the dialog on mount — same sibling convention
  // RecordingConsentDialog uses: without it the opener (the just-tapped
  // お客様を選んで録音 button) keeps keyboard focus behind the backdrop, so a
  // stray Enter re-fires it and screen-reader focus never enters the modal.
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  const factById = useMemo(
    () => new Map((facts ?? []).map((f) => [f.id, f])),
    [facts],
  )
  // Time-ascending, always: the server hands these back own-staff-first (the
  // legacy sheet's ordering) and a day list that jumps around is unreadable.
  const dayRows = useMemo(
    () => [...bookings].sort((a, b) => a.start.localeCompare(b.start)),
    [bookings],
  )
  // Booked TODAY → the 本日 HH:MM chip + status stripe on a search row. Earliest
  // wins (dayRows is time-sorted), EXCEPT that a 記録済 slot loses to any later
  // booking still open: for a customer sitting twice today the chip must point
  // at the visit that can still be recorded, not the one already written up.
  const todayByCustomer = useMemo(() => {
    const m = new Map<string, RecordTargetBooking>()
    for (const b of dayRows) {
      if (!b.customerId) continue
      const held = m.get(b.customerId)
      if (!held || (held.statusKey === 'done' && b.statusKey !== 'done')) {
        m.set(b.customerId, b)
      }
    }
    return m
  }, [dayRows])

  const trimmed = query.trim()
  const results = useMemo(
    () => filterCustomers(customers, trimmed),
    [customers, trimmed],
  )
  const searching = trimmed.length > 0

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('target.chooseCustomer')}
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[85dvh] w-[calc(100%-1.75rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl outline-none"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3.5">
          <h3 className="text-[16px] font-bold text-foreground">
            {t('target.chooseCustomer')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            // 閉じる, not キャンセル: this × dismisses the dialog, and the footer
            // button below is the one that reads as the cancel action.
            aria-label={tc('close')}
            className="flex items-center rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </header>

        {/* min-h-0 is load-bearing: without it this flex child grows past the
            dialog's max-h and the late rows run off-screen (the exact bug
            SelectBookingSheet's comment records). */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3.5">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
            <Search size={16} className="shrink-0 text-muted-foreground" aria-hidden />
            <input
              type="text"
              role="combobox"
              aria-expanded={searching}
              aria-controls={LIST_ID}
              aria-haspopup="listbox"
              aria-autocomplete="list"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tCustomers('search.placeholder')}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            {searching && (
              <button
                type="button"
                onClick={() => setQuery('')}
                // Its own label — it clears the SEARCH BOX, it does not cancel
                // the dialog. p-1 (like the header ×) so the tap target clears
                // 24px instead of being the bare 14px glyph.
                aria-label={t('target.clearSearch')}
                className="flex shrink-0 items-center rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {searching ? (
            <div id={LIST_ID} className="flex flex-col gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('target.searchResultsCount', { n: results.length })}
              </p>
              {results.length === 0 ? (
                <p className="py-4 text-center text-[13px] text-muted-foreground">
                  {tCustomers('table.noResults')}
                </p>
              ) : (
                <ul role="listbox" aria-label={t('target.searchResultsLabel')} className="flex flex-col gap-2">
                  {results.map((c) => (
                    <SearchRow
                      key={c.id}
                      customer={c}
                      fact={factById.get(c.id)}
                      todayBooking={todayByCustomer.get(c.id) ?? null}
                      onSelect={onSelectCustomer}
                      t={t}
                    />
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div id={LIST_ID} className="flex flex-col gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('target.todayBookingsCount', { n: dayRows.length })}
              </p>
              {dayRows.length === 0 ? (
                <p className="py-4 text-center text-[13px] leading-relaxed text-muted-foreground">
                  {t('target.pickerEmpty')}
                </p>
              ) : (
                // The mock's scroll cue: the day list scrolls inside its own
                // box, so without the fade a row clipped at the bottom edge
                // reads as the last one. Overlay, not a border, so it can't
                // change the list's height.
                <div className="relative">
                  <ul
                    role="listbox"
                    aria-label={t('target.sheetTitle')}
                    className="max-h-[42dvh] divide-y divide-border overflow-y-auto overscroll-contain rounded-xl border border-border"
                  >
                    {dayRows.map((b) => (
                      <BookingRow
                        key={b.id}
                        booking={b}
                        fact={b.customerId ? factById.get(b.customerId) : undefined}
                        onSelect={onSelectBooking}
                        t={t}
                      />
                    ))}
                  </ul>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-px bottom-px h-6 rounded-b-xl bg-gradient-to-b from-transparent to-card"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-border px-4 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-border bg-card text-[14.5px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            {cancelLabel}
          </button>
        </footer>
      </div>
    </>
  )
}

type T = ReturnType<typeof useTranslations>

/** Minutes between two HH:MM strings — the same derivation SelectBookingSheet
 *  uses (the picker shape carries no duration). */
function durationLabel(start: string, end: string, t: T): string {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return ''
  let minutes = eh * 60 + em - (sh * 60 + sm)
  if (minutes < 0) minutes += 24 * 60
  return t('target.durationMinutes', { n: minutes })
}

/** Left status stripe — BADGE_COLORS solids, identical to the 予約 agenda's. */
const STRIPE: Record<RecordTargetBooking['statusKey'], string> = {
  done: BADGE_COLORS.slate.solid,
  'in-session': BADGE_COLORS.orange.solid,
  booked: BADGE_COLORS.green.solid,
  new: BADGE_COLORS.blue.solid,
}

function Avatar({ initials, color }: { initials: string; color: StaffColor }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold',
        color.bg,
        color.text,
      )}
    >
      {initials}
    </span>
  )
}

function NewChip({ label }: { label: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[17px] shrink-0 items-center rounded-full border px-2 text-[9.5px] font-semibold',
        BADGE_COLORS.blue.bg,
        BADGE_COLORS.blue.text,
        BADGE_COLORS.blue.border,
      )}
    >
      {label}
    </span>
  )
}

function BookingRow({
  booking,
  fact,
  onSelect,
  t,
}: {
  booking: RecordTargetBooking
  fact: RecordCustomerFact | undefined
  onSelect: (b: RecordTargetBooking) => void
  t: T
}) {
  const staffColor = getStaffColorByKey(
    booking.staffColorKey as Parameters<typeof getStaffColorByKey>[0],
  )
  // Its karute already exists — the row is a receipt, not an offer.
  const recorded = booking.statusKey === 'done'
  const karute = booking.karute

  if (recorded) {
    return (
      // An option, explicitly unavailable. As a bare <li> this row was invisible
      // to the listbox — it dropped out of the option count and out of arrow-key
      // traversal, so the slot read as free to anyone not looking at the pixels.
      // aria-disabled, never `disabled`: it stays announced and reachable, it
      // just isn't an offer. There is no onClick — non-tappable is structural.
      <li
        role="option"
        aria-selected={false}
        aria-disabled="true"
        className="relative flex items-center gap-2.5 py-2 pl-4 pr-3 opacity-60"
      >
        <span
          aria-hidden
          className={cn('absolute inset-y-2 left-0 w-[3px] rounded-r-sm', STRIPE.done)}
        />
        <span className="w-[34px] shrink-0 text-[14.5px] font-semibold tabular-nums text-foreground">
          {booking.start}
        </span>
        <Avatar initials={booking.initials} color={staffColor} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">
          {booking.customer}
          <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">
            {t('target.honorific')}
          </span>
        </span>
        <span
          className={cn(
            'inline-flex h-[17px] shrink-0 items-center rounded-full border px-2 text-[9.5px] font-medium',
            BADGE_COLORS.slate.bg,
            BADGE_COLORS.slate.text,
            BADGE_COLORS.slate.border,
          )}
        >
          {t('target.recordedTag')}
        </span>
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={false}
        onClick={() => onSelect(booking)}
        className="relative flex w-full items-start gap-2.5 py-2.5 pl-4 pr-3 text-left transition-colors hover:bg-muted/60"
      >
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-[7px] left-0 w-[3px] rounded-r-sm',
            STRIPE[booking.statusKey],
          )}
        />
        <span className="w-[34px] shrink-0">
          <span className="block text-[14.5px] font-semibold leading-none tabular-nums text-foreground">
            {booking.start}
          </span>
          <span className="mt-1 block text-[10px] leading-none tabular-nums text-muted-foreground">
            {durationLabel(booking.start, booking.end, t)}
          </span>
        </span>
        <Avatar initials={booking.initials} color={staffColor} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-1">
            <span className="text-[13.5px] font-semibold tracking-tight text-foreground">
              {booking.customer}
              <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">
                {t('target.honorific')}
              </span>
            </span>
            {karute && (
              <span className="text-[10px] tabular-nums text-muted-foreground">{karute}</span>
            )}
          </span>
          <span className="mt-[3px] flex items-center gap-1.5">
            <span className="min-w-0 truncate text-[12px] text-foreground/85">
              {booking.service}
            </span>
            {fact?.pack && <PackPill remaining={fact.pack.remaining} size={fact.pack.size} />}
          </span>
          <span className="mt-[3px] flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <span
              aria-hidden
              className={cn('size-[5px] shrink-0 rounded-full', staffColor.stripe)}
            />
            {t('target.staffPrefix', { name: booking.staff })}
          </span>
        </span>
        {fact?.isNew && <NewChip label={t('target.firstVisit')} />}
      </button>
    </li>
  )
}

function SearchRow({
  customer,
  fact,
  todayBooking,
  onSelect,
  t,
}: {
  customer: CustomerOption
  fact: RecordCustomerFact | undefined
  todayBooking: RecordTargetBooking | null
  onSelect: (id: string) => void
  t: T
}) {
  const staffColor = getStaffColorByKey(
    fact?.staffColorKey as Parameters<typeof getStaffColorByKey>[0],
  )
  const lastVisit = fact?.lastVisitDate
    ? fact.lastVisitService
      ? t('target.lastVisitWithMenu', { date: fact.lastVisitDate, menu: fact.lastVisitService })
      : t('target.lastVisitOnly', { date: fact.lastVisitDate })
    : t('target.lastVisitNone')

  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={false}
        onClick={() => onSelect(customer.id)}
        className={cn(
          'relative flex w-full flex-col gap-1 rounded-xl border border-border py-2.5 pr-3 text-left transition-colors hover:bg-muted/60',
          todayBooking ? 'pl-4' : 'pl-3.5',
        )}
      >
        {todayBooking && (
          <span
            aria-hidden
            className={cn(
              'absolute inset-y-2 left-0 w-[3px] rounded-r-sm',
              STRIPE[todayBooking.statusKey],
            )}
          />
        )}
        <span className="flex items-center gap-2">
          <Avatar initials={deriveFamilyInitials(customer.name)} color={staffColor} />
          <span className="flex min-w-0 flex-1 items-baseline gap-1">
            <span className="min-w-0 truncate text-[13.5px] font-semibold tracking-tight text-foreground">
              {customer.name}
            </span>
            <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
              {t('target.honorific')}
            </span>
            {fact?.karuteNumber && (
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {fact.karuteNumber}
              </span>
            )}
          </span>
          <span className="ml-auto flex shrink-0 flex-col items-end gap-1">
            {fact?.pack ? (
              <PackPill remaining={fact.pack.remaining} size={fact.pack.size} />
            ) : (
              fact?.isNew && <NewChip label={t('target.firstVisit')} />
            )}
            {todayBooking && (
              <span
                className={cn(
                  'inline-flex h-[17px] items-center rounded-full border px-2 text-[9.5px] font-medium tabular-nums',
                  BADGE_COLORS.slate.bg,
                  BADGE_COLORS.slate.text,
                  BADGE_COLORS.slate.border,
                )}
              >
                {t('target.todayAt', { time: todayBooking.start })}
              </span>
            )}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{lastVisit}</span>
          {fact && !fact.hasKarute && <span>{t('target.noKarute')}</span>}
          {fact?.staffName && (
            <span className="flex items-center gap-1">
              <span
                aria-hidden
                className={cn('size-[5px] shrink-0 rounded-full', staffColor.stripe)}
              />
              {t('target.staffPrefix', { name: fact.staffName })}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}
