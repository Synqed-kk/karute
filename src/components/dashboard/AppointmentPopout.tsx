'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createAppointment } from '@/actions/appointments'
import { createCustomer } from '@/actions/customers'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import { type DailyOperatingHours, formatMinuteOfDay } from '@/lib/operating-hours'

interface AppointmentPopoutProps {
  staffId: string
  staffName: string
  startMinute: number
  selectedDate: Date
  operatingHours: DailyOperatingHours
  customers: CustomerOption[]
  onCreated: () => void
  onClose: () => void
}

function formatTime(minute: number) {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

export function AppointmentPopout({
  staffId,
  staffName,
  startMinute,
  selectedDate,
  operatingHours,
  customers,
  onCreated,
  onClose,
}: AppointmentPopoutProps) {
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')
  const tCust = useTranslations('customers')

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [duration, setDuration] = useState(60)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState('')
  const [customerList, setCustomerList] = useState(customers)

  const durationOptions = [30, 60, 90, 120]
  const allowedDurations = durationOptions.filter((option) => startMinute + option <= operatingHours.closeMinute)
  const isDurationValid = startMinute + duration <= operatingHours.closeMinute
  const endMinute = startMinute + duration
  const timeLabel = `${formatTime(startMinute)} - ${formatTime(endMinute)}`

  const filteredCustomers = searchQuery
    ? customerList.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : customerList

  useEffect(() => {
    if (allowedDurations.length === 0) return
    if (!allowedDurations.includes(duration)) {
      setDuration(allowedDurations[0])
    }
  }, [allowedDurations, duration])

  async function handleCreate() {
    if (!selectedCustomerId) return
    setSaving(true)
    setError(null)

    const startDate = new Date(selectedDate)
    startDate.setHours(Math.floor(startMinute / 60), startMinute % 60, 0, 0)

    if (startMinute < operatingHours.openMinute || !isDurationValid) {
      setError(t('operatingHoursError', { open: formatMinuteOfDay(operatingHours.openMinute), close: formatMinuteOfDay(operatingHours.closeMinute) }))
      setSaving(false)
      return
    }

    const result = await createAppointment({
      staffProfileId: staffId,
      clientId: selectedCustomerId,
      startTime: startDate.toISOString(),
      durationMinutes: duration,
      tzOffsetMinutes: startDate.getTimezoneOffset(),
    })

    if (result && 'error' in result) {
      setError(String(result.error) || t('failedToCreateAppointment'))
      setSaving(false)
      return
    }

    onCreated()
  }

  async function handleCreateCustomer() {
    if (!newCustomerName.trim()) return
    setSaving(true)
    try {
      const result = await createCustomer({ name: newCustomerName.trim() })
      if (result && 'id' in result) {
        const newCustomer = { id: result.id, name: newCustomerName.trim() }
        setCustomerList((prev) => [newCustomer, ...prev])
        setSelectedCustomerId(result.id)
        setCreatingCustomer(false)
        setNewCustomerName('')
      }
    } catch {
      setError(t('failedToCreateCustomer'))
    } finally {
      setSaving(false)
    }
  }

  const selectedCustomer = customerList.find((c) => c.id === selectedCustomerId)

  return (
    <div className="w-80 rounded-xl border border-border/50 bg-card shadow-2xl backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-200">
      <div className="border-b border-border/30 px-4 py-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('newAppointment')}</h3>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{staffName}</span>
          <span className="font-medium">{timeLabel}</span>
        </div>

        {/* Duration */}
        <div className="flex gap-1.5">
          {durationOptions.map((d) => {
            const disabled = startMinute + d > operatingHours.closeMinute
            return (
            <button key={d} type="button" onClick={() => setDuration(d)} disabled={disabled}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                duration === d
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >{d}m</button>
            )
          })}
        </div>
        {allowedDurations.length === 0 ? (
          <p className="text-xs text-destructive">
            {t('noDurationFits', { open: formatMinuteOfDay(operatingHours.openMinute), close: formatMinuteOfDay(operatingHours.closeMinute) })}
          </p>
        ) : null}

        {/* Customer */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('customer')}</label>

          {creatingCustomer ? (
            <div className="space-y-2">
              <input
                autoFocus
                type="text"
                value={newCustomerName}
                onChange={(e) => setNewCustomerName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCustomer() }}
                placeholder={t('customerNamePlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => { setCreatingCustomer(false); setNewCustomerName('') }}
                  className="flex-1 rounded-lg border border-border py-1.5 text-xs text-muted-foreground hover:bg-muted">{tc('cancel')}</button>
                <button type="button" onClick={handleCreateCustomer} disabled={!newCustomerName.trim() || saving}
                  className="flex-1 rounded-lg bg-primary py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {saving ? '...' : t('create')}
                </button>
              </div>
            </div>
          ) : selectedCustomer ? (
            <button
              type="button"
              onClick={() => { setSelectedCustomerId(''); setSearchQuery('') }}
              className="w-full flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-foreground hover:bg-primary/10 transition-colors"
            >
              {selectedCustomer.name}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          ) : (
            <>
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('searchCustomers')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <div className="mt-1.5 max-h-28 overflow-y-auto rounded-lg border border-border/50">
                {filteredCustomers.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">{t('noCustomersFound')}</div>
                ) : (
                  filteredCustomers.slice(0, 5).map((c) => (
                    <button key={c.id} type="button"
                      onClick={() => { setSelectedCustomerId(c.id); setSearchQuery('') }}
                      className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                    >{c.name}</button>
                  ))
                )}
              </div>
              <button type="button" onClick={() => setCreatingCustomer(true)}
                className="mt-1.5 w-full rounded-lg border border-dashed border-border/50 py-1.5 text-xs text-muted-foreground hover:bg-muted/30 transition-colors">
                {tCust('newCustomer')}
              </button>
            </>
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {!creatingCustomer && (
          <button type="button" onClick={handleCreate} disabled={saving || !selectedCustomerId || !isDurationValid || allowedDurations.length === 0}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? t('creating') : t('createAppointment')}
          </button>
        )}
      </div>
    </div>
  )
}
