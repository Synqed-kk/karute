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
import { StaffSelector } from '@/components/staff/StaffSelector'

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
  /** Optional content rendered BEFORE the Self/All + 担当 filter group.
   *  Used by the reservation page for the Day/Week/Month toggle. On desktop
   *  it sits inline on the same line as the filter group; on mobile it drops
   *  to its own line ABOVE the group. This keeps the scope segment and the
   *  担当 chip together on one line at 393px — previously the toggle +
   *  segment filled the first mobile row and pushed the 担当 chip alone onto
   *  a wrapped second row (an orphan pill), which also mis-anchored its
   *  dropdown off-screen. */
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
    <div
      className={`flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center ${isPending ? 'opacity-60' : ''}`}
    >
      {/* Day/Week/Month toggle (in practice). On mobile it owns its own line
       *  above the filter group; on desktop `md:flex-row` pulls it inline. */}
      {prependSlot}
      {/* Scope segment + 担当 chip — kept together as ONE group so they stay
       *  on a single line at 393px. The chip is the last item (right side of
       *  the row), so its dropdown opens leftward and on-screen. */}
      <div className="flex flex-wrap items-center gap-2">
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
        {/* 担当 chip — names the current selection inline (avatar + name),
         *  and tapping it opens the shared dropdown. */}
        <StaffSelector
          staffList={staffList}
          selected={selected}
          onChange={(next) => setStaff(next)}
          compact
        />
      </div>
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

