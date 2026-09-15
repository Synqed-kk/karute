'use client'

// ─────────────────────────────────────────────────────────────
// StoreHoursBlock — one store's own weekly 営業時間, edited in the 店舗 row
// ─────────────────────────────────────────────────────────────
// Per ROW, exactly like name/address: the store pill / active store is never
// consulted — an owner edits any store's hours from its own row.
//
// FREE typed times (⚖ no hardcoded durations): `<input type="time">`, any
// minute, and the phone's own native time picker for free. Deliberately NOT
// the 組織 editor's 30-minute <select> (OrganizationSection.tsx TIME_OPTIONS) —
// that fixed list is queued debt, not a pattern to copy. The ~40 lines of
// weekday markup below are copied from that editor WITH the inputs swapped;
// a shared component waits until two proven editors exist.
//
// ALL SEVEN WEEKDAYS SAVE AT ONCE. resolveDayHours reads an ABSENT weekday as
// 定休日 once the object carries any key, so a one-day save would close the
// store the other six. The payload built here always carries all seven, and
// parseStoreWeeklyHours — the SAME function the server gate uses — is what
// decides whether 保存 is even enabled, so the two can never disagree.
//
// TYPE: the app's own classes, taken from this row's neighbours in
// StoresSection.tsx (name 15/600, meta 12, actions 13/500, badges 10/500) and
// the weekday markup's source (OrganizationSection.tsx: text-sm inputs,
// text-xs errors). No font-bold anywhere.
//
// MOTION: none. The disclosure is a plain conditional render and the rows
// carry no transition, so Reduce Motion has nothing to honour or to lie about.

import { useCallback, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import type { WeeklyHours } from '@synqed-kk/client'

import { setStoreHours } from '@/actions/stores'
import {
  DEFAULT_OPERATING_HOURS,
  WEEKDAY_KEYS,
  formatMinuteOfDay,
  normalizeOperatingHours,
  type OperatingHours,
  type WeekdayKey,
} from '@/lib/operating-hours'
import {
  parseStoreWeeklyHours,
  STORE_HOURS_INVALID_WINDOW,
  STORE_HOURS_WEEK_INCOMPLETE,
} from '@/lib/validations/store'

const DAY_LABELS: Record<WeekdayKey, { en: string; ja: string }> = {
  mon: { en: 'Mon', ja: '月' },
  tue: { en: 'Tue', ja: '火' },
  wed: { en: 'Wed', ja: '水' },
  thu: { en: 'Thu', ja: '木' },
  fri: { en: 'Fri', ja: '金' },
  sat: { en: 'Sat', ja: '土' },
  sun: { en: 'Sun', ja: '日' },
}

/** One editable weekday. `closed` = 定休日 = the null this store sends for it. */
type DayDraft = { closed: boolean; open: string; close: string }
type WeekDraft = Record<WeekdayKey, DayDraft>

/** `<input type="time">` tops out at 23:59, so the business-wide default's
 *  24:00 close (DEFAULT_DAILY_OPERATING_HOURS) has no representation in the
 *  field. Clamped for the PRE-FILL only, which is explicitly marked unsaved —
 *  nothing already saved is ever rewritten by this. A true midnight close is
 *  the same queued gap as an overnight window. */
function hhmmForInput(minute: number): string {
  return formatMinuteOfDay(Math.min(minute, 23 * 60 + 59))
}

/** The store's own week when it has one; otherwise the business-wide hours as
 *  a STARTING POINT — what the resolver would use for this store today. */
function seedDraft(
  weeklyHours: WeeklyHours | null | undefined,
  orgHours: OperatingHours,
): WeekDraft {
  const draft = {} as WeekDraft
  for (const key of WEEKDAY_KEYS) {
    const own = weeklyHours?.[key]
    if (weeklyHours && Object.keys(weeklyHours).length > 0) {
      // null OR absent = 定休日 — the resolver's own reading of this shape.
      draft[key] = own
        ? { closed: false, open: own.open, close: own.close }
        : { closed: true, open: '10:00', close: '19:00' }
      continue
    }
    draft[key] = {
      closed: false,
      open: hhmmForInput(orgHours[key].openMinute),
      close: hhmmForInput(orgHours[key].closeMinute),
    }
  }
  return draft
}

/** The draft as the wire shape — ALWAYS seven keys. */
function draftToWeeklyHours(draft: WeekDraft): WeeklyHours {
  const week: WeeklyHours = {}
  for (const key of WEEKDAY_KEYS) {
    const day = draft[key]
    week[key] = day.closed ? null : { open: day.open, close: day.close }
  }
  return week
}

interface StoreHoursBlockProps {
  storeId: string
  storeName: string
  /** The store's own hours. `undefined` = this read never asked (the block is
   *  only rendered on a read that did); `null` = never configured. */
  weeklyHours: WeeklyHours | null | undefined
  /** The business-wide 営業時間 — the labelled default, and the pre-fill. */
  orgHours: OperatingHours | null | undefined
}

export function StoreHoursBlock({
  storeId,
  storeName,
  weeklyHours,
  orgHours,
}: StoreHoursBlockProps) {
  const t = useTranslations('settings.stores.hours')
  const locale = useLocale()
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-3 border-t border-border/30 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex h-8 items-center rounded-md px-2 text-[13px] font-medium text-foreground/80 ring-1 ring-gray-200 hover:bg-gray-50 dark:ring-white/10 dark:hover:bg-white/[0.04]"
      >
        {open ? t('hide') : t('title')}
      </button>
      {open && (
        <StoreHoursEditor
          // Re-seeds only when the store changes, never on a parent refresh:
          // StoresSection's refresh() re-lists WITHOUT hours, and a re-seed
          // from that would wipe what this editor just saved.
          key={storeId}
          storeId={storeId}
          storeName={storeName}
          weeklyHours={weeklyHours}
          orgHours={orgHours}
          locale={locale}
          t={t}
        />
      )}
    </div>
  )
}

function StoreHoursEditor({
  storeId,
  storeName,
  weeklyHours,
  orgHours,
  locale,
  t,
}: StoreHoursBlockProps & {
  locale: string
  t: ReturnType<typeof useTranslations<'settings.stores.hours'>>
}) {
  const normalizedOrg = normalizeOperatingHours(orgHours ?? DEFAULT_OPERATING_HOURS)
  const [draft, setDraft] = useState<WeekDraft>(() => seedDraft(weeklyHours, normalizedOrg))
  /** True until this store has a saved week of its own — the pre-fill is the
   *  business-wide default and must never read as this store's own hours. */
  const [unsaved, setUnsaved] = useState(
    !weeklyHours || Object.keys(weeklyHours).length === 0,
  )
  const [saving, setSaving] = useState(false)
  /** The weekday whose 休業 flip is awaiting confirmation. */
  const [confirmDay, setConfirmDay] = useState<WeekdayKey | null>(null)
  /** The 初期値に戻す press awaiting confirmation. */
  const [confirmReset, setConfirmReset] = useState(false)

  const parsed = parseStoreWeeklyHours(draftToWeeklyHours(draft))
  const invalid = 'error' in parsed

  const setDay = useCallback((key: WeekdayKey, next: Partial<DayDraft>) => {
    setDraft((prev) => ({ ...prev, [key]: { ...prev[key], ...next } }))
  }, [])

  const save = useCallback(async () => {
    const week = draftToWeeklyHours(draft)
    const check = parseStoreWeeklyHours(week)
    if ('error' in check) {
      toast.error(t(errorKey(check.error)))
      return
    }
    setSaving(true)
    const result = await setStoreHours(storeId, week)
    setSaving(false)
    if ('error' in result) {
      toast.error(knownError(result.error) ? t(errorKey(result.error)) : result.error)
      return
    }
    setUnsaved(false)
    toast.success(t('saved'))
  }, [draft, storeId, t])

  /** ⚖ reversible-by-default — the way back. An explicit `null` week through
   *  the SAME core the save uses ("clear back to unconfigured", the SDK's own
   *  words), so the store returns to 全店共通の初期値 and the editor goes back
   *  to showing that default as a starting point, not as this store's truth. */
  const resetToDefault = useCallback(async () => {
    setSaving(true)
    const result = await setStoreHours(storeId, null)
    setSaving(false)
    if ('error' in result) {
      toast.error(knownError(result.error) ? t(errorKey(result.error)) : result.error)
      return
    }
    setConfirmReset(false)
    setDraft(seedDraft(null, normalizedOrg))
    setUnsaved(true)
    toast.success(t('resetDone'))
  }, [normalizedOrg, storeId, t])

  return (
    <div className="mt-3">
      <p className="text-[12px] text-muted-foreground">{t('description')}</p>
      {unsaved && (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200/60 dark:bg-amber-500/10 dark:ring-amber-500/20">
          <div className="text-[12px] font-medium text-amber-800 dark:text-amber-300">
            {t('usingDefault')}
          </div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-amber-800/90 dark:text-amber-300/85">
            {t('usingDefaultHint')}
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {WEEKDAY_KEYS.map((key) => {
          const day = draft[key]
          const dayLabel = locale === 'ja' ? DAY_LABELS[key].ja : DAY_LABELS[key].en
          const dayInvalid = !day.closed && !(day.open < day.close)
          return (
            <div key={key}>
              <div className="grid grid-cols-[40px_1fr_16px_1fr_64px] items-center gap-2">
                <span className="text-[13px] font-medium text-foreground">{dayLabel}</span>
                <input
                  type="time"
                  value={day.open}
                  disabled={day.closed}
                  aria-label={`${storeName} ${dayLabel} ${t('openLabel')}`}
                  onChange={(e) => setDay(key, { open: e.target.value })}
                  className={`w-full rounded-lg border bg-background px-2 py-2 text-[13px] tabular-nums focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 ${
                    dayInvalid ? 'border-destructive/60' : 'border-border'
                  }`}
                />
                <span className="text-center text-muted-foreground">-</span>
                <input
                  type="time"
                  value={day.close}
                  disabled={day.closed}
                  aria-label={`${storeName} ${dayLabel} ${t('closeLabel')}`}
                  onChange={(e) => setDay(key, { close: e.target.value })}
                  className={`w-full rounded-lg border bg-background px-2 py-2 text-[13px] tabular-nums focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 ${
                    dayInvalid ? 'border-destructive/60' : 'border-border'
                  }`}
                />
                <button
                  type="button"
                  aria-pressed={day.closed}
                  onClick={() => {
                    // Turning a day OFF is the consequential direction — it is
                    // the one that stops 予約 — so only that way asks.
                    if (day.closed) setDay(key, { closed: false })
                    else setConfirmDay(key)
                  }}
                  className={`rounded-md border px-2 py-1.5 text-xs font-medium ${
                    day.closed
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t('closedToggle')}
                </button>
              </div>
              {dayInvalid && (
                <p className="mt-1 text-xs text-destructive">{t('invalidWindow')}</p>
              )}
              {confirmDay === key && (
                <div className="mt-1.5 rounded-lg bg-muted px-3 py-2">
                  <p className="text-[12px] leading-relaxed text-foreground">
                    {t('closedConfirm', { day: dayLabel })}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDay(key, { closed: true })
                        setConfirmDay(null)
                      }}
                      className="inline-flex h-8 items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 text-[12px] font-medium text-amber-700 dark:text-amber-400"
                    >
                      {t('closedConfirmYes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDay(null)}
                      className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-muted"
                    >
                      {t('closedConfirmNo')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={invalid || saving}
          className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? t('saving') : t('save')}
        </button>
        {invalid && (
          <span className="text-[12px] text-muted-foreground">{t('fixBeforeSaving')}</span>
        )}
        {/* The way back, offered ONLY once this store has a week of its own —
         *  there is nothing to undo while it is still on the default. */}
        {!unsaved && (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            disabled={saving}
            className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {t('resetToDefault')}
          </button>
        )}
      </div>
      {confirmReset && (
        <div className="mt-2 rounded-lg bg-muted px-3 py-2">
          <p className="text-[12px] leading-relaxed text-foreground">{t('resetConfirm')}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={resetToDefault}
              disabled={saving}
              className="inline-flex h-8 items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 text-[12px] font-medium text-amber-700 disabled:opacity-50 dark:text-amber-400"
            >
              {t('resetConfirmYes')}
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-muted"
            >
              {t('closedConfirmNo')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function knownError(error: string): boolean {
  return error === STORE_HOURS_WEEK_INCOMPLETE || error === STORE_HOURS_INVALID_WINDOW
}

function errorKey(error: string): 'weekIncomplete' | 'invalidWindow' {
  return error === STORE_HOURS_WEEK_INCOMPLETE ? 'weekIncomplete' : 'invalidWindow'
}
