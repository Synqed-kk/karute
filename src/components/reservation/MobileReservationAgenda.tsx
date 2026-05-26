'use client'

import { useTranslations } from 'next-intl'

import { AppointmentCard } from '@/components/reservation/AppointmentCard'
import type { ReservationView } from '@/lib/adapters/reservation-view'

interface MobileReservationAgendaProps {
  reservations: ReservationView[]
  onSelect?: (view: ReservationView) => void
}

export function MobileReservationAgenda({ reservations, onSelect }: MobileReservationAgendaProps) {
  const t = useTranslations('reservation')
  const sorted = [...reservations].sort((a, b) => a.startTimeHm.localeCompare(b.startTimeHm))

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        {t('mobile.empty')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((r) => (
        <AppointmentCard
          key={r.id}
          view={r}
          variant="agenda"
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
