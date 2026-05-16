'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useRouter } from '@/i18n/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { CustomerCombobox } from '@/components/karute/CustomerCombobox'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import { createAppointment } from '@/actions/appointments'

interface NewBookingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customers: CustomerOption[]
  staff: { id: string; name: string }[]
  /** Pre-filled date (YYYY-MM-DD) when opening from a specific calendar day. */
  initialDate?: string
  /** Pre-filled time (HH:MM) when opening from a slot tap. */
  initialTime?: string
  /** Pre-selected staff (e.g. the active staff member). */
  initialStaffId?: string | null
  /** Pre-selected customer when opening from a customer profile. */
  initialClientId?: string | null
  onCreated?: () => void
}

const DURATION_OPTIONS = ['30', '45', '60', '75', '90']

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function defaultTime(): string {
  // Snap "now" up to the next 30-minute boundary as a sensible default.
  const d = new Date()
  const m = d.getMinutes() < 30 ? 30 : 0
  const h = d.getMinutes() < 30 ? d.getHours() : (d.getHours() + 1) % 24
  return `${pad2(h)}:${pad2(m)}`
}

export function NewBookingDialog({
  open,
  onOpenChange,
  customers,
  staff,
  initialDate,
  initialTime,
  initialStaffId,
  initialClientId,
  onCreated,
}: NewBookingDialogProps) {
  const t = useTranslations('reservation')
  const router = useRouter()
  const [clientId, setClientId] = useState<string | null>(initialClientId ?? null)
  const [date, setDate] = useState(initialDate ?? todayYmd())
  const [time, setTime] = useState(initialTime ?? defaultTime())
  const [duration, setDuration] = useState('60')
  const [staffId, setStaffId] = useState<string>(
    initialStaffId ?? staff[0]?.id ?? '',
  )
  const [service, setService] = useState('')
  const [saving, setSaving] = useState(false)

  // Re-seed defaults when the dialog reopens for a different slot.
  useEffect(() => {
    if (!open) return
    setClientId(initialClientId ?? null)
    setDate(initialDate ?? todayYmd())
    setTime(initialTime ?? defaultTime())
    setStaffId(initialStaffId ?? staff[0]?.id ?? '')
    setService('')
  }, [open, initialClientId, initialDate, initialTime, initialStaffId, staff])

  const canSubmit = !!clientId && !!date && !!time && !!staffId && !saving

  async function handleSave() {
    if (!clientId) {
      toast.error('Pick a customer')
      return
    }
    const durationMinutes = parseInt(duration, 10)
    if (Number.isNaN(durationMinutes) || durationMinutes <= 0) {
      toast.error('Invalid duration')
      return
    }
    // Local Date constructor treats "YYYY-MM-DDTHH:MM:SS" as local time —
    // exactly what the user typed on the form.
    const startLocal = new Date(`${date}T${time}:00`)
    if (Number.isNaN(startLocal.getTime())) {
      toast.error('Invalid date or time')
      return
    }

    setSaving(true)
    const result = await createAppointment({
      staffProfileId: staffId,
      clientId,
      startTime: startLocal.toISOString(),
      durationMinutes,
      tzOffsetMinutes: -startLocal.getTimezoneOffset(),
      title: service.trim() || undefined,
    })
    setSaving(false)

    if ('error' in result) {
      toast.error(result.error)
      return
    }
    toast.success(t('toasts.bookingCreated'))
    onOpenChange(false)
    onCreated?.()
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('newBookingDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('newBookingDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label={t('newBookingDialog.customer')} required>
            <CustomerCombobox
              customers={customers}
              selectedId={clientId}
              onSelect={setClientId}
              onCreateNew={() => {
                toast.message(t('newBookingDialog.createCustomerHint'))
              }}
              placeholder={t('newBookingDialog.customerPlaceholder')}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('newBookingDialog.date')} required>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label={t('newBookingDialog.time')} required>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('newBookingDialog.duration')}>
              <select
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {DURATION_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {t('card.duration', { n: parseInt(v, 10) })}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('newBookingDialog.staff')}>
              <select
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={t('newBookingDialog.service')}>
            <Input
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder={t('newBookingDialog.servicePlaceholder')}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('newBookingDialog.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {saving ? t('newBookingDialog.saving') : t('newBookingDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}
