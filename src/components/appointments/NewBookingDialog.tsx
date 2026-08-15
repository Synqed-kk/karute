'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { X } from 'lucide-react'
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
import { MenuCombobox, formatYen } from '@/components/appointments/MenuCombobox'
import { createAppointment } from '@/actions/appointments'
import { hmInJst, jstWallTimeToDate, ymdInJst } from '@/lib/date/jst'
import type { CachedMenuOption } from '@/lib/menus/cached'

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
  /** Active menu catalog for the picker. Absent/empty = today's plain
   *  free-text service field (a shop with no catalog gets no picker chrome). */
  menus?: CachedMenuOption[]
  onCreated?: () => void
}

const DURATION_OPTIONS = ['30', '45', '60', '75', '90']
const DEFAULT_DURATION = '60'

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
  menus,
  onCreated,
}: NewBookingDialogProps) {
  const t = useTranslations('reservation')
  const router = useRouter()
  const [clientId, setClientId] = useState<string | null>(initialClientId ?? null)
  const [date, setDate] = useState(initialDate ?? todayYmdJst())
  const [time, setTime] = useState(initialTime ?? defaultTimeJst())
  const [duration, setDuration] = useState(DEFAULT_DURATION)
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
  // Local mirror of `menus`, seeded once per open: the 60s cached read can
  // degrade mid-entry and hand down an EMPTY catalog. Consuming the prop
  // directly would then swap the field to the plain <Input> and yank the
  // combobox out from under a cursor that is mid-word. (An armed link is
  // safe either way — linkedMenu is its own state.)
  const [menuList, setMenuList] = useState<CachedMenuOption[]>(menus ?? [])
  const [linkedMenu, setLinkedMenu] = useState<CachedMenuOption | null>(null)
  // R8: only a real user change on the select counts as touched — a touched
  // duration then survives every pick, re-pick and unlink.
  const [durationTouched, setDurationTouched] = useState(false)
  const [prePickDuration, setPrePickDuration] = useState<string | null>(null)
  const [showDurationReminder, setShowDurationReminder] = useState(false)
  // seq remounts the live region's text node so an identical repeat still
  // announces.
  const [announcement, setAnnouncement] = useState({ text: '', seq: 0 })
  const serviceInputRef = useRef<HTMLInputElement>(null)

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
    // Duration resets too (R8 rule 1): without it booking 2 inherits booking
    // 1's length, which nothing on screen explains.
    setDuration(DEFAULT_DURATION)
    setMenuList(menus ?? [])
    setLinkedMenu(null)
    setDurationTouched(false)
    setPrePickDuration(null)
    setShowDurationReminder(false)
    setAnnouncement({ text: '', seq: 0 })
  }, [open, initialClientId, initialDate, initialTime, initialStaffId, staff, customers, menus])

  // Transient nudge — the revert already happened, this only says so.
  useEffect(() => {
    if (!showDurationReminder) return
    const timer = setTimeout(() => setShowDurationReminder(false), 4000)
    return () => clearTimeout(timer)
  }, [showDurationReminder])

  // No path may blank the select: base steps ∪ the current value ∪ the linked
  // menu's standard, so a 120分 menu is always reachable and a 120分 booking
  // never loses its own value when the link drops.
  const durationOptions = useMemo(() => {
    const minutes = new Set(DURATION_OPTIONS.map(Number))
    const current = parseInt(duration, 10)
    if (Number.isFinite(current)) minutes.add(current)
    if (linkedMenu) minutes.add(linkedMenu.duration_minutes)
    return [...minutes].sort((a, b) => a - b).map(String)
  }, [duration, linkedMenu])

  function announce(text: string) {
    setAnnouncement((prev) => ({
      text,
      seq: prev.seq + 1,
    }))
  }

  function announceDuration(minutes: number) {
    announce(t('newBookingDialog.menuDurationAnnounce', { n: minutes }))
  }

  function handlePickMenu(menu: CachedMenuOption) {
    // Only the FIRST link records the pre-link duration — a re-pick must still
    // revert to what the staff had before the picker touched anything.
    if (!linkedMenu) setPrePickDuration(duration)
    setLinkedMenu(menu)
    setService(menu.name)
    setShowDurationReminder(false)
    if (durationTouched) return
    setDuration(String(menu.duration_minutes))
    announceDuration(menu.duration_minutes)
  }

  /** Manual text edit or the chip's × — the text always stays, only the link
   *  goes. An untouched duration goes back to its pre-link value.
   *  The nudge and its announcement fire ONLY when that revert actually moved
   *  the number: a 60→60 "revert" raising the amber alarm would teach the
   *  staff to ignore it on the day it means a wrong-length booking. */
  function dropMenuLink() {
    if (!linkedMenu) return
    setLinkedMenu(null)
    if (durationTouched) return
    const reverted = prePickDuration
    setPrePickDuration(null)
    if (reverted === null || reverted === duration) return
    setDuration(reverted)
    setShowDurationReminder(true)
    announce(
      t('newBookingDialog.menuDurationRevertAnnounce', {
        n: parseInt(reverted, 10),
      }),
    )
  }

  function handleApplyMenuStandard() {
    if (!linkedMenu) return
    setDuration(String(linkedMenu.duration_minutes))
    // Re-arms: the staff handed the decision back to the menu.
    setDurationTouched(false)
    setShowDurationReminder(false)
    announceDuration(linkedMenu.duration_minutes)
  }

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
      // Free text books without one; core validates ownership and snapshots
      // the price itself.
      menuId: linkedMenu?.id,
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
            <div>
              <Field
                label={t('newBookingDialog.duration')}
                accessory={
                  // Fixed height reserves the pill's row so showing it never
                  // jogs the select below.
                  <span className="ml-2 inline-flex h-[18px] items-center align-middle">
                    {showDurationReminder && (
                      <span className="animate-in fade-in rounded-full bg-amber-50 px-2 text-[11px] leading-[18px] font-medium text-amber-700 motion-reduce:animate-none dark:bg-amber-500/10 dark:text-amber-300">
                        {t('newBookingDialog.menuDurationReminder')}
                      </span>
                    )}
                  </span>
                }
              >
                <select
                  value={duration}
                  onChange={(e) => {
                    if (e.target.value === duration) return
                    setDuration(e.target.value)
                    setDurationTouched(true)
                    setShowDurationReminder(false)
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {durationOptions.map((v) => (
                    <option key={v} value={v}>
                      {t('card.duration', { n: parseInt(v, 10) })}
                    </option>
                  ))}
                </select>
              </Field>
              {/* Outside the Field so this button never doubles as a click on
                  the label's select. */}
              {linkedMenu && (
                <button
                  type="button"
                  onClick={handleApplyMenuStandard}
                  className="mt-1 text-xs text-primary hover:underline"
                >
                  {t('newBookingDialog.menuStandard', {
                    n: linkedMenu.duration_minutes,
                  })}
                </button>
              )}
            </div>
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

          <div>
            <Field label={t('newBookingDialog.service')}>
              {menuList.length === 0 ? (
                <Input
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  placeholder={t('newBookingDialog.servicePlaceholder')}
                />
              ) : (
                <MenuCombobox
                  menus={menuList}
                  value={service}
                  linkedMenuId={linkedMenu?.id ?? null}
                  onTextChange={(text) => {
                    setService(text)
                    dropMenuLink()
                  }}
                  onPick={handlePickMenu}
                  placeholder={t('newBookingDialog.servicePlaceholder')}
                  inputRef={serviceInputRef}
                />
              )}
            </Field>
            {linkedMenu && (
              <span className="mt-1.5 inline-flex items-center gap-0.5 rounded-full bg-primary/8 py-0.5 pr-0.5 pl-2.5 text-xs text-primary">
                {t('newBookingDialog.menuLinked', {
                  price: formatYen(linkedMenu.price_list_amount),
                })}
                <button
                  type="button"
                  aria-label={t('newBookingDialog.menuUnlink')}
                  onClick={(e) => {
                    // Take focus explicitly. Chrome does it on mousedown, and
                    // the resulting focusout is what CLOSES a list that was
                    // already open; desktop Safari/Firefox never focus a
                    // clicked <button>, so without this the field keeps focus
                    // and the upward list stays parked over the very pill the
                    // × just raised. Same chain on every engine, and focus
                    // never leaves the dialog on the way.
                    e.currentTarget.focus()
                    dropMenuLink()
                    // Focus goes back to the field the staff was editing; the
                    // catalog stays shut on its own, because the list opens on
                    // a tap and never on bare focus.
                    serviceInputRef.current?.focus()
                  }}
                  className="inline-flex size-6 items-center justify-center rounded-full text-primary hover:bg-primary/12"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            )}
          </div>
        </div>

        <div aria-live="polite" className="sr-only">
          <span key={announcement.seq}>{announcement.text}</span>
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
  accessory,
  children,
}: {
  label: string
  required?: boolean
  /** Inline slot after the label text (the 時間を確認 pill). */
  accessory?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
        {accessory}
      </span>
      {children}
    </label>
  )
}
