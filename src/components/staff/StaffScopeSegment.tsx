'use client'

// 自分 | 全スタッフ ⌄ — the ONE staff control on 予約 and 顧客
// (⚖ STAFF CONTROL LOCKED 04:5x, Liam).
//
//  - Segment 1 = 自分. Segment 2 = the STATE label (全スタッフ, or the picked
//    staffer's family name) + a chevron. The word 担当 never shows here.
//  - The chevron opens the SAME StaffSelector panel the カルテ 担当 chip opens
//    (自分 → 全スタッフ → names, with its search) — StaffSelector draws the
//    panel, this file only draws the trigger (renderTrigger). No fork.
//  - ⚖ TAP RULE (Liam 04:0x): segment 2's label, when it is not the active
//    segment (state 自分), = 全スタッフ in one tap; a tap on segment 2 while it
//    IS active (全スタッフ, or a picked name) opens the list. The chevron
//    always opens the list. 自分 = 'self'; a second tap on 自分 does nothing.
//  - State = the existing StaffFilterKey ('all' | 'self' | staffId); the
//    caller owns where it lives (顧客 `?s=`, 予約 `?staff=`) and passes the
//    RESOLVED value (staff-scope.ts resolveStaffScope).
//
// Look = the app's own segment (the 自分/全スタッフ ScopeToggle this replaces,
// CustomersStaffFilter.tsx / ReservationStaffFilter.tsx: h-9 track, p-0.5,
// border, bg-muted/50, text-xs font-medium; segments px-3 gap-1.5). The
// pressed segment = the repo's R13 selected recipe (CLAUDE.md): bg-primary/8 +
// the accent as text (its darker pair here, S52 B4 below) — StaffSelector's
// own narrowed trigger wears the same wash; a
// segment has no border of its own, so no border-primary. No new sizes, no
// new type.
// Words = ONE pair of keys on both tabs (reservation.staffFilter).

import { ChevronDown, User, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  StaffSelector,
  familyName,
  type StaffSelectorEntry,
} from '@/components/staff/StaffSelector'
import { cn } from '@/lib/utils'

// S52 B4 — the pressed LABEL reads in the accent's darker pair
// (--primary-hover, globals.css): text-primary over this control's muted
// track + the 8% wash is 4.44:1, under AA; the pair gives 5.76:1.
// This is the AA exception written into CLAUDE.md's selected/pressed-state rule.
const SEGMENT_ON = 'bg-primary/8 text-primary-hover'
const SEGMENT_OFF = 'text-muted-foreground hover:text-foreground'

export function StaffScopeSegment({
  staffList,
  selfStaffId,
  selected,
  onChange,
  badgeOnly = false,
}: {
  staffList: StaffSelectorEntry[]
  /** The viewer's own staff id; null hides 自分 (no profile, nothing to be). */
  selfStaffId: string | null
  /** RESOLVED scope: 'all' | 'self' | a staff id ON staffList. */
  selected: string
  onChange: (next: string) => void
  /** The カルテ chip row's trim step 1 (⚖ S46 option C): a picked staffer
   *  shows as their badge only — the name text is left out; the label button
   *  keeps the full name as its accessible name. Default = as before. */
  badgeOnly?: boolean
}) {
  const t = useTranslations('reservation.staffFilter')
  const tPanel = useTranslations('staffSelector')

  // Nothing to pick and nobody to be: no control (same rule as the rows it
  // replaces).
  if (staffList.length === 0 && !selfStaffId) return null

  const isSelf = selected === 'self'
  const canOpen = staffList.length > 0

  return (
    <StaffSelector
      staffList={staffList}
      selected={selected}
      onChange={onChange}
      scope={{ selfStaffId, selfLabel: t('self'), allLabel: t('all') }}
      renderTrigger={({ open, setOpen, listboxId, active, activeColor }) => (
        <div
          data-staff-scope=""
          className="inline-flex h-9 w-fit items-stretch rounded-full border border-border bg-muted/50 p-0.5 text-xs font-medium"
        >
          {selfStaffId && (
            <button
              type="button"
              aria-pressed={isSelf}
              onClick={() => {
                // A second tap on 自分 has nothing to pick — it does nothing.
                if (isSelf) return
                setOpen(false)
                onChange('self')
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 transition-all',
                isSelf ? SEGMENT_ON : SEGMENT_OFF,
              )}
            >
              <User size={13} aria-hidden />
              <span>{t('self')}</span>
            </button>
          )}
          {/* Segment 2 — ONE capsule holding two taps: the state label and the
           *  chevron. 3px + 3px between them = the segments' own gap-1.5, so the
           *  two read as one segment. */}
          <div
            className={cn(
              'relative inline-flex items-stretch rounded-full transition-all',
              isSelf ? SEGMENT_OFF : SEGMENT_ON,
            )}
          >
            <button
              type="button"
              aria-pressed={!isSelf}
              // Active segment: the label tap opens the list (the TAP RULE),
              // so it announces the popup; from 自分 it is a plain toggle.
              aria-haspopup={!isSelf && canOpen ? 'listbox' : undefined}
              aria-expanded={!isSelf && canOpen ? open : undefined}
              // A picked staffer is spoken by their FULL name — the visible
              // label is the family name only (S46).
              aria-label={active ? active.name : undefined}
              onClick={() => {
                if (isSelf) {
                  setOpen(false)
                  onChange('all')
                  return
                }
                if (canOpen) setOpen(!open)
              }}
              className={cn(
                'inline-flex min-w-0 items-center gap-1.5 rounded-full pl-3',
                canOpen ? 'pr-[3px]' : 'pr-3',
              )}
            >
              {active ? (
                <>
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                      activeColor?.bg,
                      activeColor?.text,
                    )}
                    aria-hidden
                  >
                    {active.initials}
                  </span>
                  {!badgeOnly && (
                    <span className="max-w-[6rem] truncate">{familyName(active.name)}</span>
                  )}
                </>
              ) : (
                <>
                  <Users size={13} aria-hidden />
                  <span>{t('all')}</span>
                </>
              )}
            </button>
            {canOpen && (
              <button
                type="button"
                aria-label={tPanel('title')}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listboxId : undefined}
                data-staff-scope-chevron=""
                onClick={() => setOpen(!open)}
                // S52 B3 — a bigger tap target, no layout change: a transparent
                // ::after, placed on the capsule (so this button's own box and
                // width stay as they were), spans the track's full height (36)
                // and reaches its right edge (-3 = p-0.5 + the border). Its LEFT
                // edge = this button's own left edge, never over the label: from
                // 自分 the label is a plain toggle (the TAP RULE), so a strip of
                // it must not open the list. Width 31 = this button's 28
                // (pl-[3px] + the 13px glyph + pr-3) + those 3px — change one,
                // change the other (staff-scope-segment.test.tsx pins the sum).
                className="inline-flex items-center rounded-full pl-[3px] pr-3 after:absolute after:-inset-y-[3px] after:-right-[3px] after:w-[31px]"
              >
                <ChevronDown
                  size={13}
                  className={cn(
                    'shrink-0 transition-transform',
                    // Inside the pressed segment the chevron takes the
                    // segment's accent, as StaffSelector's narrowed chevron.
                    isSelf ? 'text-muted-foreground' : 'text-primary',
                    open && 'rotate-180',
                  )}
                  aria-hidden
                />
              </button>
            )}
          </div>
        </div>
      )}
    />
  )
}
