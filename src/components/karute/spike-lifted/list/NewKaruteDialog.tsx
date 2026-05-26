'use client'

// ─────────────────────────────────────────────────────────────
// NewKaruteDialog — manual karute creation
// ─────────────────────────────────────────────────────────────
// LIFTED + ADAPTED FROM SPIKE
//   src: synqed-karute-design-spike/src/components/karute-list/NewKaruteDialog.tsx
//
// Opened by the "+ 新規カルテ" CTA on the karute list. Earlier
// implementation routed the click straight to /sessions (the
// recording page) — wrong UX. Manual karute creation and starting
// a recording session are TWO different intents:
//
//   "+ 新規カルテ"          → backdate / log a session manually
//                            (this dialog)
//   bottom-nav 「録音」     → start an AI-assisted recording flow
//
// Karute adaptations from the spike:
//   useT() / useTheme()      → useTranslations()
//   Hard-coded BOOKABLE_STAFF → real karute getStaffList() output,
//                              passed as a prop from the page
//   Plain text customer field → existing CustomerCombobox +
//                              QuickCreateCustomer pair (the same
//                              picker the recording flow uses in
//                              SaveKaruteFlow / RecordingPanel —
//                              so walk-in customers can be created
//                              inline without leaving the dialog,
//                              matching the recording flow's UX)
//   setTimeout stub          → createManualKaruteRecord server
//                              action → synqed.karuteRecords.create
//                              with status='DRAFT'
//
// ANTHONY: service / duration_minutes / session_date columns aren't
// yet on karute_records, so those three dialog fields are captured
// but dropped server-side. Add the columns + this dialog persists
// the full payload without further changes here.

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
import { QuickCreateCustomer } from '@/components/karute/QuickCreateCustomer'

import { createManualKaruteRecord } from '@/actions/karute'

const DURATION_OPTIONS = [30, 45, 60, 90] as const
type Duration = (typeof DURATION_OPTIONS)[number]

interface StaffOption {
  id: string
  name: string
}

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
    date.length > 0 &&
    customerFlow === 'combobox' &&
    !pending

  // ── handlers ───────────────────────────────────────────────
  const reset = () => {
    setCustomerList(customers)
    setSelectedCustomerId(null)
    setCustomerFlow('combobox')
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
    // Mirror SaveKaruteFlow's pattern: prepend to local list, auto-select,
    // return to combobox view.
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
          {/* Customer picker — uses the same combobox + quick-create
           *  pair the recording flow uses (SaveKaruteFlow). Walk-in
           *  customers can be created inline. */}
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
              />
            ) : (
              <CustomerCombobox
                customers={customerList}
                selectedId={selectedCustomerId}
                onSelect={(id) => setSelectedCustomerId(id)}
                onCreateNew={() => setCustomerFlow('quick-create')}
                placeholder={t('customerPlaceholder')}
                disabled={pending}
              />
            )}
          </div>

          {/* Date + Duration — two-up */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="new-karute-date"
                className="text-xs font-medium text-foreground"
              >
                {t('dateLabel')}
                <span aria-hidden className="ml-1 text-destructive">
                  *
                </span>
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
              {/* Native <select> instead of a shadcn primitive — karute's
               *  ui/ folder doesn't ship a Select today. Native is fully
               *  accessible + matches the input height when styled
               *  consistently with karute's Input class. */}
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

          {/* Staff */}
          <div className="space-y-1.5">
            <label
              htmlFor="new-karute-staff"
              className="text-xs font-medium text-foreground"
            >
              {t('staffLabel')}
            </label>
            <select
              id="new-karute-staff"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              disabled={pending}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Service */}
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

          {/* Tip banner — encourage the recording flow for AI
              auto-fill, matches the spike's blue-tint info block. */}
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
            className="bg-sage-800 text-white hover:bg-sage-900 disabled:bg-muted disabled:text-muted-foreground"
          >
            {pending ? t('creating') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
