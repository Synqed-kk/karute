'use client'

import { useState } from 'react'
import { createAppointment } from '@/actions/appointments'
import { CustomerCombobox, type CustomerOption } from '@/components/karute/CustomerCombobox'
import { QuickCreateCustomer } from '@/components/karute/QuickCreateCustomer'

interface AppointmentPopoutProps {
  staffId: string
  staffName: string
  startMinute: number
  selectedDate: Date
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
  customers: initialCustomers,
  onCreated,
  onClose,
}: AppointmentPopoutProps) {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [customerList, setCustomerList] = useState(initialCustomers)
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const [duration, setDuration] = useState(60)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const endMinute = startMinute + duration
  const timeLabel = `${formatTime(startMinute)} - ${formatTime(endMinute)}`

  async function handleCreate() {
    if (!selectedCustomerId) return
    setSaving(true)
    setError(null)

    // Build ISO start time from selectedDate + startMinute
    const startDate = new Date(selectedDate)
    startDate.setHours(Math.floor(startMinute / 60), startMinute % 60, 0, 0)

    const result = await createAppointment({
      staffProfileId: staffId,
      clientId: selectedCustomerId,
      startTime: startDate.toISOString(),
      durationMinutes: duration,
    })

    if ('error' in result) {
      setError(result.error ?? 'Failed to create appointment')
      setSaving(false)
      return
    }

    onCreated()
  }

  function handleCustomerCreated(newCustomer: CustomerOption) {
    setCustomerList((prev) => [newCustomer, ...prev])
    setSelectedCustomerId(newCustomer.id)
    setShowQuickCreate(false)
  }

  return (
    <div className="absolute z-50 w-72 rounded-xl border border-border/50 bg-card shadow-2xl backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-200">
      <div className="border-b border-border/30 px-4 py-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">New Appointment</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-4 space-y-3">
        {/* Staff + Time */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{staffName}</span>
          <span className="font-medium">{timeLabel}</span>
        </div>

        {/* Duration selector */}
        <div className="flex gap-1.5">
          {[30, 60, 90, 120].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                duration === d
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {d}m
            </button>
          ))}
        </div>

        {/* Customer selector */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Customer</label>
          {showQuickCreate ? (
            <QuickCreateCustomer
              onCreated={handleCustomerCreated}
              onCancel={() => setShowQuickCreate(false)}
            />
          ) : (
            <CustomerCombobox
              customers={customerList}
              selectedId={selectedCustomerId}
              onSelect={setSelectedCustomerId}
              onCreateNew={() => setShowQuickCreate(true)}
              disabled={saving}
            />
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* Create button */}
        {!showQuickCreate && (
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !selectedCustomerId}
            className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Creating...' : 'Create Appointment'}
          </button>
        )}
      </div>
    </div>
  )
}
