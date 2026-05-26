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
// SCOPE NOTE — fields shown vs schema
// ────────────────────────────────────
// karute_records currently persists customer_id + staff_id + status.
// The spike's dialog had session_date / duration_minutes / service
// inputs, BUT karute_records has no columns for those today, so
// shipping the inputs would mean staff fills them in and the values
// silently vanish on submit — same '施術' fallback shape we just
// cleaned up across the codebase. So the dialog renders only the
// two fields that actually persist (customer + staff) and a banner
// pointing at the recording flow for the rest.
//
// ANTHONY: once karute_records has `service text`,
// `duration_minutes int`, `session_date date` columns, restore the
// three inputs by un-commenting the marked blocks below and
// passing them through createManualKaruteRecord. The server action
// already accepts the values (and drops them); flipping the
// schema lights up the full payload without further changes here.
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
import { Button } from '@/components/ui/button'

import {
  CustomerCombobox,
  type CustomerOption,
} from '@/components/karute/CustomerCombobox'
import { QuickCreateCustomer } from '@/components/karute/QuickCreateCustomer'

import { createManualKaruteRecord } from '@/actions/karute'

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
  const [staffId, setStaffId] = useState<string>(
    defaultStaffId ?? staffList[0]?.id ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const selectedCustomer = useMemo(
    () => customerList.find((c) => c.id === selectedCustomerId) ?? null,
    [customerList, selectedCustomerId],
  )

  const canSubmit =
    !!selectedCustomer &&
    !!staffId &&
    customerFlow === 'combobox' &&
    !pending

  // ── handlers ───────────────────────────────────────────────
  const reset = () => {
    setCustomerList(customers)
    setSelectedCustomerId(null)
    setCustomerFlow('combobox')
    setStaffId(defaultStaffId ?? staffList[0]?.id ?? '')
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
        // ANTHONY: session_date / duration / service hardcoded
        // defaults because karute_records has no columns for them
        // yet. The server action accepts + drops the values. Once
        // the schema lands, plumb real values from re-added inputs
        // above (see SCOPE NOTE at the top of this file).
        sessionDate: todayIso(),
        durationMinutes: 60,
        service: '',
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
          {/* Customer picker — combobox + inline quick-create */}
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

          {/* Staff picker — native <select> until karute ships a
           *  shadcn Select primitive. */}
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

          {/* Session date / duration / service intentionally NOT
           *  shown — karute_records has no columns for them, so
           *  the server action would drop the values silently.
           *  See SCOPE NOTE at the top of this file. The tip
           *  banner below redirects staff to the recording flow
           *  for everything beyond customer + staff. */}

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
            className="bg-sage-800 text-white hover:bg-sage-900 disabled:bg-muted disabled:text-muted-foreground"
          >
            {pending ? t('creating') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
