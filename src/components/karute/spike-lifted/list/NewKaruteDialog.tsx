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
//   Customer text input      → real combobox over the page's
//                              customer list, so submit binds to
//                              a real customer_id (the spike just
//                              stored the typed text)
//   setTimeout stub          → calls createManualKaruteRecord
//                              server action which calls
//                              synqed.karuteRecords.create with
//                              status='DRAFT' (ANTHONY: schema
//                              gaps for service / duration /
//                              session_date documented inline)
//
// On successful create the server action redirects to
// /karute/[id] — staff drops directly into the new record to
// start filling in entries.

import { useId, useMemo, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Search, X } from 'lucide-react'

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

import { createManualKaruteRecord } from '@/actions/karute'

const DURATION_OPTIONS = [30, 45, 60, 90] as const
type Duration = (typeof DURATION_OPTIONS)[number]

interface StaffOption {
  id: string
  name: string
}

interface CustomerOption {
  id: string
  name: string
  karuteNumber?: string
}

interface NewKaruteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staffList: StaffOption[]
  customers: CustomerOption[]
  /** Viewer's staff id — pre-selects the staff dropdown when known. */
  defaultStaffId?: string | null
}

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
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerOption | null>(null)
  const [customerQuery, setCustomerQuery] = useState('')
  const [date, setDate] = useState<string>(todayIso())
  const [duration, setDuration] = useState<Duration>(60)
  const [staffId, setStaffId] = useState<string>(
    defaultStaffId ?? staffList[0]?.id ?? '',
  )
  const [service, setService] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const customerInputRef = useRef<HTMLInputElement>(null)
  const customerListboxId = useId()

  // ── derived ────────────────────────────────────────────────
  // Filter the customer list as staff types. Cap at 8 entries so
  // a 500-customer salon doesn't render a giant scroll list under
  // a short query.
  const matchingCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase()
    if (selectedCustomer || q === '') return []
    return customers
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [customerQuery, customers, selectedCustomer])

  const canSubmit =
    !!selectedCustomer && !!staffId && date.length > 0 && !pending

  // ── handlers ───────────────────────────────────────────────
  const reset = () => {
    setSelectedCustomer(null)
    setCustomerQuery('')
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
          {/* Customer combobox */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              {t('customerLabel')}
              <span aria-hidden className="ml-1 text-destructive">
                *
              </span>
            </label>
            {selectedCustomer ? (
              <div className="inline-flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-muted/40 px-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {selectedCustomer.name}
                  </span>
                  {selectedCustomer.karuteNumber && (
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {selectedCustomer.karuteNumber}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(null)
                    setCustomerQuery('')
                    // Restore focus to the search input so staff can
                    // immediately retype if they picked the wrong row.
                    setTimeout(() => customerInputRef.current?.focus(), 0)
                  }}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={t('customerClear')}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  ref={customerInputRef}
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder={t('customerPlaceholder')}
                  autoComplete="off"
                  role="combobox"
                  aria-controls={customerListboxId}
                  aria-expanded={matchingCustomers.length > 0}
                  className="h-10 pl-8"
                />
                {customerQuery.trim().length > 0 && (
                  <div
                    id={customerListboxId}
                    role="listbox"
                    className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-card shadow-sm"
                  >
                    {matchingCustomers.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        {t('customerNotFound')}
                      </div>
                    ) : (
                      matchingCustomers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => {
                            setSelectedCustomer(c)
                            setCustomerQuery('')
                          }}
                          className="flex w-full items-center justify-between gap-2 border-b border-border/50 px-3 py-2 text-left text-sm text-foreground transition-colors last:border-b-0 hover:bg-muted"
                        >
                          <span className="truncate">{c.name}</span>
                          {c.karuteNumber && (
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              {c.karuteNumber}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
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
                className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
              className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
