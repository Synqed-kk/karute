'use client'

import { useEffect, useRef, useState } from 'react'
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
import { QuickCreateCustomer } from '@/components/karute/QuickCreateCustomer'
import { createAppointment } from '@/actions/appointments'
import { hmInJst, jstWallTimeToDate, ymdInJst } from '@/lib/date/jst'

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

type CustomerFlowState = 'combobox' | 'quick-create'

function todayYmdJst(): string {
  return ymdInJst()
}

function defaultTimeJst(): string {
  // Snap "now" up to the next 30-minute boundary in JST.
  const now = new Date()
  const [hStr, mStr] = hmInJst(now).split(':')
  const minutes = Number(mStr)
  const hour = Number(hStr)
  if (minutes < 30) return `${String(hour).padStart(2, '0')}:30`
  return `${String((hour + 1) % 24).padStart(2, '0')}:00`
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
  const [date, setDate] = useState(initialDate ?? todayYmdJst())
  const [time, setTime] = useState(initialTime ?? defaultTimeJst())
  const [duration, setDuration] = useState('60')
  const [staffId, setStaffId] = useState<string>(
    initialStaffId ?? staff[0]?.id ?? '',
  )
  const [service, setService] = useState('')
  const [saving, setSaving] = useState(false)
  // Local mirror of `customers` so QuickCreateCustomer can append + auto-select
  // without a server round-trip back to the page (same pattern as NewKaruteDialog).
  const [customerList, setCustomerList] = useState<CustomerOption[]>(customers)
  const [customerFlow, setCustomerFlow] = useState<CustomerFlowState>('combobox')
  // Seeds QuickCreateCustomer's name input with whatever the staff had already
  // typed into the combobox before tapping "+ 新規顧客".
  const [quickCreateSeed, setQuickCreateSeed] = useState('')

  // Re-seed defaults ONLY on the closed→open transition. Quick-create's
  // revalidateTag refresh hands this component fresh prop identities while
  // the dialog is still open — reacting to those would wipe the staff's
  // in-progress entry (including the just-created customer selection).
  const wasOpen = useRef(false)
  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      return
    }
    if (wasOpen.current) return
    wasOpen.current = true
    setClientId(initialClientId ?? null)
    setDate(initialDate ?? todayYmdJst())
    setTime(initialTime ?? defaultTimeJst())
    setStaffId(initialStaffId ?? staff[0]?.id ?? '')
    setService('')
    setCustomerList(customers)
    setCustomerFlow('combobox')
    setQuickCreateSeed('')
  }, [open, initialClientId, initialDate, initialTime, initialStaffId, staff, customers])

  const canSubmit =
    !!clientId && !!date && !!time && !!staffId && customerFlow === 'combobox' && !saving

  function handleCustomerCreated(newCustomer: CustomerOption) {
    setCustomerList((prev) => [newCustomer, ...prev])
    setClientId(newCustomer.id)
    setCustomerFlow('combobox')
  }

  async function handleSave() {
    if (!clientId) {
      toast.error(t('newBookingDialog.toasts.customerMissing'))
      return
    }
    const durationMinutes = parseInt(duration, 10)
    if (Number.isNaN(durationMinutes) || durationMinutes <= 0) {
      toast.error(t('newBookingDialog.toasts.invalidDuration'))
      return
    }
    // The user types JST wall-clock time. Anchor to JST explicitly so the
    // resulting UTC ISO doesn't drift with the runtime's local timezone.
    const startJst = jstWallTimeToDate(date, time)
    if (Number.isNaN(startJst.getTime())) {
      toast.error(t('newBookingDialog.toasts.invalidDateTime'))
      return
    }

    setSaving(true)
    const result = await createAppointment({
      staffProfileId: staffId,
      clientId,
      startTime: startJst.toISOString(),
      durationMinutes,
      // utcToLocalDayAndMinute (the validator) uses getTimezoneOffset
      // semantics: positive when local is behind UTC, negative when ahead.
      // JST is UTC+9 with no DST → always -540. Hard-coding decouples this
      // from the browser's tz, so a traveler in PDT still gets their input
      // interpreted as JST (which is what the form labels say).
      tzOffsetMinutes: -540,
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
            {customerFlow === 'quick-create' ? (
              <QuickCreateCustomer
                onCreated={handleCustomerCreated}
                onCancel={() => setCustomerFlow('combobox')}
                initialName={quickCreateSeed}
              />
            ) : (
              <CustomerCombobox
                customers={customerList}
                selectedId={clientId}
                onSelect={setClientId}
                onCreateNew={(q) => {
                  setQuickCreateSeed(q ?? '')
                  setCustomerFlow('quick-create')
                }}
                placeholder={t('newBookingDialog.customerPlaceholder')}
              />
            )}
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
