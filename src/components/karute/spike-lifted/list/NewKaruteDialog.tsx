'use client'

// ─────────────────────────────────────────────────────────────
// NewKaruteDialog — manual karute creation
// ─────────────────────────────────────────────────────────────
// Opened by the "+ 新規カルテ" CTA on the karute list. Manual karute
// creation and starting an AI recording session are two distinct
// intents with distinct surfaces:
//
//   "+ 新規カルテ"          → backdate / log a session manually
//                            (this dialog)
//   bottom-nav 「録音」     → start an AI-assisted recording flow
//
// FIELDS
// ──────
// karute_records has persisted session_date/duration_minutes/service
// since the 2026-06-11 migration (synqed-core), and
// createManualKaruteRecord already forwards all three — so every field
// below is live and writes through on submit.
//
// Customer picker uses the same CustomerCombobox + QuickCreateCustomer
// pair the recording flow uses (SaveKaruteFlow / RecordingPanel),
// so walk-in customers can be created inline.

import { useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'

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

import {
  CustomerCombobox,
  type CustomerOption,
} from '@/components/karute/CustomerCombobox'
import {
  StaffCombobox,
  type StaffComboboxOption as StaffOption,
} from '@/components/karute/StaffCombobox'
import { QuickCreateCustomer } from '@/components/karute/QuickCreateCustomer'

import { createManualKaruteRecord } from '@/actions/karute'

const DURATION_OPTIONS = [30, 45, 60, 90] as const
type Duration = (typeof DURATION_OPTIONS)[number]

interface NewKaruteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staffList: StaffOption[]
  customers: CustomerOption[]
  /** Viewer's staff id — pre-selects the staff dropdown when known. */
  defaultStaffId?: string | null
}

type CustomerFlowState = 'combobox' | 'quick-create'

function todayIso(): string {
  // Local time, not UTC — staff picks "today" in their tz.
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function NewKaruteDialog({
  open,
  onOpenChange,
  staffList,
  customers,
  defaultStaffId = null,
}: NewKaruteDialogProps) {
  const t = useTranslations('karute.recordList.newKaruteDialog')

  // ── form state ─────────────────────────────────────────────
  // Local mirror so QuickCreateCustomer appends + auto-selects
  // without a server round-trip back to the page.
  const [customerList, setCustomerList] = useState<CustomerOption[]>(customers)
  const [selectedCustomerId, setSelectedCustomerId] =
    useState<string | null>(null)
  const [customerFlow, setCustomerFlow] =
    useState<CustomerFlowState>('combobox')
  // Seeds QuickCreateCustomer's name input with whatever the staff had
  // already typed into the combobox before tapping "+ 新規顧客".
  const [quickCreateSeed, setQuickCreateSeed] = useState('')
  const [date, setDate] = useState<string>(todayIso())
  const [duration, setDuration] = useState<Duration>(60)
  const [staffId, setStaffId] = useState<string>(
    defaultStaffId ?? staffList[0]?.id ?? '',
  )
  const [service, setService] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const selectedCustomer = useMemo(
    () => customerList.find((c) => c.id === selectedCustomerId) ?? null,
    [customerList, selectedCustomerId],
  )

  const canSubmit =
    !!selectedCustomer &&
    !!staffId &&
    !!date &&
    customerFlow === 'combobox' &&
    !pending

  // ── handlers ───────────────────────────────────────────────
  const reset = () => {
    setCustomerList(customers)
    setSelectedCustomerId(null)
    setCustomerFlow('combobox')
    setQuickCreateSeed('')
    setDate(todayIso())
    setDuration(60)
    setStaffId(defaultStaffId ?? staffList[0]?.id ?? '')
    setService('')
    setError(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleCustomerCreated = (newCustomer: CustomerOption) => {
    setCustomerList((prev) => [newCustomer, ...prev])
    setSelectedCustomerId(newCustomer.id)
    setCustomerFlow('combobox')
  }

  const handleSubmit = () => {
    if (!canSubmit || !selectedCustomer) return
    setError(null)
    startTransition(async () => {
      const result = await createManualKaruteRecord({
        customerId: selectedCustomer.id,
        staffId,
        sessionDate: date,
        durationMinutes: duration,
        service: service.trim(),
      })
      // On success the action redirects — we never reach here.
      // Only error returns land here.
      if (result && 'error' in result) {
        setError(t('errorGeneric'))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Customer picker — combobox + inline quick-create. ACTIVE. */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              {t('customerLabel')}
              <span aria-hidden className="ml-1 text-destructive">
                *
              </span>
            </label>
            {customerFlow === 'quick-create' ? (
              <QuickCreateCustomer
                onCreated={handleCustomerCreated}
                onCancel={() => setCustomerFlow('combobox')}
                initialName={quickCreateSeed}
              />
            ) : (
              <CustomerCombobox
                customers={customerList}
                selectedId={selectedCustomerId}
                onSelect={(id) => setSelectedCustomerId(id)}
                onCreateNew={(q) => {
                  setQuickCreateSeed(q ?? '')
                  setCustomerFlow('quick-create')
                }}
                placeholder={t('customerPlaceholder')}
                disabled={pending}
              />
            )}
          </div>

          {/* Date + Duration — two-up. ACTIVE. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="new-karute-date"
                className="text-xs font-medium text-foreground"
              >
                {t('dateLabel')}
              </label>
              <Input
                id="new-karute-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={pending}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="new-karute-duration"
                className="text-xs font-medium text-foreground"
              >
                {t('durationLabel')}
              </label>
              <select
                id="new-karute-duration"
                value={duration}
                onChange={(e) =>
                  setDuration(Number(e.target.value) as Duration)
                }
                disabled={pending}
                className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {DURATION_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Staff — ACTIVE. karute_records has staff_id, this persists. */}
          <div className="space-y-1.5">
            <label
              htmlFor="new-karute-staff"
              className="text-xs font-medium text-foreground"
            >
              {t('staffLabel')}
            </label>
            {/* Searchable: 経営メンバー are out of the default list but stay
             *  selectable by typing. defaultStaffId is the viewer's own id, so
             *  a management member always sees themselves. */}
            <StaffCombobox
              id="new-karute-staff"
              staff={staffList}
              selectedId={staffId || null}
              onSelect={setStaffId}
              selfId={defaultStaffId ?? null}
              disabled={pending}
            />
          </div>

          {/* Service — ACTIVE. */}
          <div className="space-y-1.5">
            <label
              htmlFor="new-karute-service"
              className="text-xs font-medium text-foreground"
            >
              {t('serviceLabel')}
            </label>
            <Input
              id="new-karute-service"
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder={t('servicePlaceholder')}
              disabled={pending}
              className="h-10"
            />
          </div>

          {/* Tip banner — encourage the recording flow for full
              session capture with AI auto-fill. */}
          <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-xs leading-relaxed text-blue-900 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
            {t('tipMessage')}
          </div>

          {error && (
            <p
              role="alert"
              className="text-xs font-medium text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="disabled:bg-muted disabled:text-muted-foreground"
          >
            {pending ? t('creating') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
