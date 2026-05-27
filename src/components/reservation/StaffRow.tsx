'use client'

import { useTranslations } from 'next-intl'

import { AppointmentCard } from '@/components/reservation/AppointmentCard'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import { getStaffColor } from '@/lib/staff-colors'
import { cn } from '@/lib/utils'

export const STAFF_ROW_HEIGHT = 88
export const STAFF_COL_WIDTH = 200

export interface ReservationStaff {
  id: string
  name: string
  role: string
  takesBookings: boolean
  initials: string
}

interface StaffRowProps {
  staff: ReservationStaff
  reservations: ReservationView[]
  startHour: number
  ppm: number
  totalWidth: number
  onSelect?: (view: ReservationView) => void
}

export function StaffRow({ staff, reservations, startHour, ppm, totalWidth, onSelect }: StaffRowProps) {
  const t = useTranslations('reservation')
  const color = getStaffColor(staff.id)
  return (
    <div className="flex border-b border-border last:border-b-0">
      <div
        className="flex shrink-0 items-center gap-2 border-r border-border px-3"
        style={{ width: STAFF_COL_WIDTH, height: STAFF_ROW_HEIGHT }}
      >
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
          style={
            staff.takesBookings
              ? { background: color.bg, color: color.text }
              : { background: 'var(--muted)', color: 'var(--muted-foreground)' }
          }
        >
          {staff.initials}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{staff.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {staff.takesBookings
              ? t('grid.staffMeta', { role: staff.role, count: reservations.length })
              : staff.role}
          </div>
        </div>
      </div>
      <div
        className={cn(
          'relative shrink-0',
          !staff.takesBookings && 'reservation-block-pattern flex items-center justify-center',
        )}
        style={{ width: totalWidth, height: STAFF_ROW_HEIGHT }}
      >
        {!staff.takesBookings ? (
          <span className="text-xs text-muted-foreground">{t('grid.blockOwner')}</span>
        ) : (
          reservations.map((r) => (
            <AppointmentCard
              key={r.id}
              view={r}
              variant="grid"
              ppm={ppm}
              startHour={startHour}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  )
}
