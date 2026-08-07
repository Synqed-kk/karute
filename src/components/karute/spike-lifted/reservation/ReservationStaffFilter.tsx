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
  /** Optional content rendered BEFORE the Self/All segmented toggle in the
   *  same flex row. Used by the reservation page to place the
   *  Day/Week/Month toggle compact and inline on the same line as the scope
   *  toggle and the 担当 chip. The 担当 chip shows only the family name once a
   *  staff is picked, so the whole row fits on one line at Liam's 440px. */
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
    // One row: Day/Week/Month toggle (prependSlot) + Self/All segmented toggle
    // + 担当 chip, all inline. The 担当 chip shows just the family name once a
    // staff is picked, so all three fit on one line at 440px. flex-wrap is a
    // graceful backstop on the narrowest phones; the dropdown clamps itself
    // on-screen (StaffSelector) if the chip ever wraps far-left.
    // gap-y-3 (Liam 8/7): when 担当 wraps to its own line on narrow phones
    // the 8px row gap read as touching — vertical breathing room only,
    // horizontal stays gap-2.
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-3 ${isPending ? 'opacity-60' : ''}`}
    >
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
      {/* 担当 chip — names the current selection inline (avatar + family
       *  name), and tapping it opens the shared dropdown. */}
      <StaffSelector
        staffList={staffList}
        selected={selected}
        onChange={(next) => setStaff(next)}
        compact
      />
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

