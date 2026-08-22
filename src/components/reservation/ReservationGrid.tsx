'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  TimeAxis,
  CurrentTimeIndicator,
  type BusinessHours,
} from '@/components/reservation/TimeAxis'
import {
  StaffRow,
  STAFF_COL_WIDTH,
  STAFF_ROW_HEIGHT,
  type ReservationStaff,
} from '@/components/reservation/StaffRow'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import { assignStaffColors } from '@/lib/staff-colors'

const HOUR_WIDTH = 140
const AXIS_HEIGHT = 32

interface ReservationGridProps {
  staff: ReservationStaff[]
  reservations: ReservationView[]
  businessHours: BusinessHours
  /** Every staff id in the ACTIVE STORE. assignStaffColors assigns by sorted
   *  position, so the palette must come from the store roster, not from the
   *  lanes actually drawn — otherwise hiding one member re-hues everyone after
   *  them. Omitted OR EMPTY → today's behavior (colored over the lanes): the
   *  facade DTO defaults this to [] so a skewed bundle can't blank the screen,
   *  and [] must degrade to the old look, not paint every lane neutral. */
  colorRosterIds?: readonly string[]
  onSelect?: (view: ReservationView) => void
}

export function ReservationGrid({ staff, reservations, businessHours, colorRosterIds, onSelect }: ReservationGridProps) {
  const t = useTranslations('reservation')
  const ppm = HOUR_WIDTH / 60
  const totalWidth = (businessHours.end - businessHours.start) * HOUR_WIDTH
  const laneStackHeight = staff.length * STAFF_ROW_HEIGHT
  // Distinct color per staff over the ACTIVE STORE's roster (colorRosterIds) —
  // same sorted-index assignment the adapter uses, so the column avatar and
  // the appointment-card avatars line up on the same hue.
  const staffColors = useMemo(
    () => assignStaffColors(colorRosterIds?.length ? colorRosterIds : staff.map((s) => s.id)),
    [colorRosterIds, staff],
  )

  return (
    <div className="reservation-grid-scroll overflow-x-auto rounded-xl border border-border">
      <div style={{ minWidth: STAFF_COL_WIDTH + totalWidth }}>
        <div className="flex border-b border-border">
          <div
            className="flex shrink-0 items-end px-3 pb-1"
            style={{ width: STAFF_COL_WIDTH, height: AXIS_HEIGHT }}
          >
            <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
              {t('grid.staffColumnLabel')}
            </span>
          </div>
          <div className="relative flex-1" style={{ width: totalWidth }}>
            <TimeAxis businessHours={businessHours} ppm={ppm} />
          </div>
        </div>
        <div className="relative">
          <div
            className="absolute"
            style={{
              left: STAFF_COL_WIDTH,
              top: 0,
              height: laneStackHeight,
              width: totalWidth,
              pointerEvents: 'none',
            }}
          >
            <CurrentTimeIndicator
              businessHours={businessHours}
              ppm={ppm}
              height={laneStackHeight}
            />
          </div>
          {staff.map((s) => {
            const rs = reservations.filter((r) => r.staffId === s.id)
            return (
              <StaffRow
                key={s.id}
                staff={s}
                staffColorKey={staffColors.get(s.id)?.key ?? 'neutral'}
                reservations={rs}
                startHour={businessHours.start}
                ppm={ppm}
                totalWidth={totalWidth}
                onSelect={onSelect}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
