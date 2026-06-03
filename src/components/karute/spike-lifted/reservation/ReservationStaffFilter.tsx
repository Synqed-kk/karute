'use client'

// LIFTED FROM SPIKE (pattern: same as CustomersStaffFilter)
//   spike src: /Users/liam/Documents/synqed-karute-design-spike/src/components/shared/ViewModeSelector.tsx
//
// Self / All / per-staff filter for the 予約 tab. Mirrors the existing
// CustomersStaffFilter visually (segmented Self|All toggle + colored
// avatar pills per staff) so the picker reads identically on the customer
// list and the reservation list. Different prop shape because:
//   - reservation page is server-rendered and uses URL state (?staff=…)
//   - customer list is client-side controlled state
// The visual idiom is identical though, so the design stays consistent.
//
// Selection model: a single string — 'all' | 'self' | <staffId>. Clicking
// an already-active pill snaps back to 'all'. The Self segment hides when
// the viewer has no staff identity (e.g. owner with no `staff_profile`).

import { useTransition } from 'react'
import { User, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { assignStaffColors, getStaffColorByKey, type StaffColor } from '@/lib/staff-colors'
import { cn } from '@/lib/utils'

export interface ReservationStaffEntry {
  id: string
  name: string
  initials: string
}

interface Props {
  staffList: ReservationStaffEntry[]
  selfStaffId: string | null
  /** Active filter key from the URL — 'all' | 'self' | <staffId>. */
  selected: string
  /** Optional content rendered BEFORE the Self/All segmented toggle in the
   *  same flex row. Used by the reservation page to place the
   *  Day/Week/Month toggle on the same line as the scope toggle, mirroring
   *  the spike's `ViewModeSelector` `prependSlot` pattern. Wraps with the
   *  toggle on narrow viewports. */
  prependSlot?: React.ReactNode
}

export function ReservationStaffFilter({
  staffList,
  selfStaffId,
  selected,
  prependSlot,
}: Props) {
  const t = useTranslations('reservation.staffFilter')
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [isPending, startTransition] = useTransition()
  // Distinct color per staff over the FULL roster of chips (sorted-index
  // assignment, no collisions) — same mapping the agenda/grid use.
  const staffColors = assignStaffColors(staffList.map((s) => s.id))

  function setStaff(next: string) {
    const params = new URLSearchParams(search?.toString() ?? '')
    if (next === 'all') params.delete('staff')
    else params.set('staff', next)
    const qs = params.toString()
    const href = qs ? `${pathname}?${qs}` : pathname
    startTransition(() => router.push(href))
  }

  // Empty when there's no staff to filter AND no self identity — nothing to
  // pick. Avoids rendering an empty row.
  if (staffList.length === 0 && !selfStaffId) return null

  return (
    <div className={`flex flex-col gap-2 ${isPending ? 'opacity-60' : ''}`}>
      {/* Row 1: prepend slot (Day/Week/Month toggle in practice) +
       *  Self/All segmented toggle. Same row so the chrome above the
       *  agenda is one line on most viewports. */}
      <div className="flex flex-wrap items-center gap-2">
        {prependSlot}
        <div className="inline-flex h-9 w-fit items-stretch rounded-full border border-border bg-muted/50 p-0.5 text-xs font-medium">
          {selfStaffId && (
            <SegmentButton
              active={selected === 'self'}
              onClick={() => setStaff('self')}
              icon={<User size={13} />}
              label={t('self')}
            />
          )}
          <SegmentButton
            active={selected === 'all'}
            onClick={() => setStaff('all')}
            icon={<Users size={13} />}
            label={t('all')}
          />
        </div>
      </div>

      {/* Per-staff pills with deterministic colors. >3 staff still renders
       *  inline as flex-wrap — at salon scale this stays readable. If a
       *  tenant ever has 15+ staff, consider switching to the spike's
       *  dropdown picker (see ViewModeSelector). */}
      {staffList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {staffList.map((s) => (
            <StaffPill
              key={s.id}
              staff={s}
              color={getStaffColorByKey(staffColors.get(s.id)?.key)}
              active={selected === s.id}
              onClick={() => setStaff(selected === s.id ? 'all' : s.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SegmentButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 transition-all ${
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function StaffPill({
  staff,
  color,
  active,
  onClick,
}: {
  staff: ReservationStaffEntry
  color: StaffColor
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-8 items-center gap-2 rounded-full border pl-1 pr-3 text-xs font-medium transition-colors ${
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-card text-foreground hover:bg-muted'
      }`}
    >
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ring-1 ring-black/5',
          color.bg,
          color.text,
        )}
        aria-hidden
      >
        {staff.initials}
      </span>
      <span className="max-w-[120px] truncate">{staff.name}</span>
    </button>
  )
}
