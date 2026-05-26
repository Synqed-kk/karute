'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { upsertOrgSettings, type OrgSettings } from '@/actions/org-settings'
import {
  DEFAULT_OPERATING_HOURS,
  WEEKDAY_KEYS,
  normalizeOperatingHours,
  validateDailyOperatingHours,
  formatMinuteOfDay,
  type OperatingHours,
  type WeekdayKey,
} from '@/lib/operating-hours'
import { getBusinessProfile } from '@/lib/welcome/business-types'

const BUSINESS_TYPES = [
  { value: 'hair_salon', labelEn: '✂️ Hair Salon', labelJa: '✂️ ヘアサロン' },
  { value: 'esthetic_salon', labelEn: '💆 Esthetic Salon', labelJa: '💆 エステサロン' },
  { value: 'nail_salon', labelEn: '💅 Nail Salon', labelJa: '💅 ネイルサロン' },
  { value: 'eyelash_salon', labelEn: '👁️ Eyelash Salon', labelJa: '👁️ アイラッシュ' },
  { value: 'massage', labelEn: '🤲 Massage', labelJa: '🤲 マッサージ' },
  { value: 'chiropractic', labelEn: '💪 Chiropractic', labelJa: '💪 整体・整骨院' },
  { value: 'beauty_chiropractic', labelEn: '✨ Beauty Chiropractic', labelJa: '✨ 美容整体' },
  { value: 'dental_clinic', labelEn: '🦷 Dental', labelJa: '🦷 歯科' },
  { value: 'medical_clinic', labelEn: '🏥 Medical Clinic', labelJa: '🏥 医療クリニック' },
  { value: 'personal_gym', labelEn: '🏋️ Personal Gym', labelJa: '🏋️ パーソナルジム' },
  { value: 'yoga_studio', labelEn: '🧘 Yoga / Pilates', labelJa: '🧘 ヨガ・ピラティス' },
  { value: 'other', labelEn: '🏢 Other', labelJa: '🏢 その他' },
]

const DAY_LABELS: Record<WeekdayKey, { en: string; ja: string }> = {
  mon: { en: 'Mon', ja: '月' },
  tue: { en: 'Tue', ja: '火' },
  wed: { en: 'Wed', ja: '水' },
  thu: { en: 'Thu', ja: '木' },
  fri: { en: 'Fri', ja: '金' },
  sat: { en: 'Sat', ja: '土' },
  sun: { en: 'Sun', ja: '日' },
}

const TIME_OPTIONS = Array.from({ length: 49 }, (_, idx) => idx * 30)

const TIMEZONES = [
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Asia/Seoul', label: 'Asia/Seoul (KST)' },
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
  { value: 'Asia/Bangkok', label: 'Asia/Bangkok (ICT)' },
  { value: 'UTC', label: 'UTC' },
]

interface OrganizationSectionProps {
  orgSettings: OrgSettings | null
  locale: string
}

export function OrganizationSection({
  orgSettings,
  locale,
}: OrganizationSectionProps) {
  const t = useTranslations('settings')
  const tc = useTranslations('common')
  const router = useRouter()

  const initialHours = normalizeOperatingHours(
    orgSettings?.operating_hours ?? DEFAULT_OPERATING_HOURS,
  )
  const [salonName, setSalonName] = useState(orgSettings?.salon_name ?? '')
  const [businessType, setBusinessType] = useState(
    orgSettings?.business_type ?? 'other',
  )
  const [timezone, setTimezone] = useState(orgSettings?.timezone ?? 'Asia/Tokyo')
  const [soloMode, setSoloMode] = useState(orgSettings?.solo_mode ?? false)
  const [webhookUrl, setWebhookUrl] = useState(orgSettings?.webhook_url ?? '')
  const [hours, setHours] = useState<OperatingHours>(initialHours)
  const [hoursErrors, setHoursErrors] = useState<
    Partial<Record<WeekdayKey, string>>
  >({})
  const [saving, setSaving] = useState(false)

  const save = useCallback(
    async (partial: Partial<OrgSettings>, quiet = false) => {
      setSaving(true)
      const result = await upsertOrgSettings(partial)
      setSaving(false)
      if ('error' in result) toast.error(result.error)
      else if (!quiet) toast.success(t('settingsSaved'))
    },
    [t],
  )

  const handleHoursChange = useCallback(
    async (
      dayKey: WeekdayKey,
      field: 'openMinute' | 'closeMinute',
      value: number,
    ) => {
      const nextHours: OperatingHours = {
        ...hours,
        [dayKey]: { ...hours[dayKey], [field]: value },
      }
      setHours(nextHours)
      const error = validateDailyOperatingHours(nextHours[dayKey])
      setHoursErrors((prev) => {
        const next = { ...prev }
        if (error) next[dayKey] = error
        else delete next[dayKey]
        return next
      })
      if (error) return
      await save({ operating_hours: nextHours })
    },
    [hours, save],
  )

  const profile = orgSettings?.business_type
    ? getBusinessProfile(orgSettings.business_type)
    : null

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t('organization')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('organizationDescription')}
        </p>
      </div>

      {/* Setup status */}
      <div
        className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${
          orgSettings?.setup_completed_at
            ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
            : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
        }`}
      >
        {orgSettings?.setup_completed_at ? (
          <CheckCircle2 className="size-4 shrink-0" />
        ) : (
          <AlertCircle className="size-4 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium">
            {orgSettings?.setup_completed_at
              ? t('setupComplete')
              : t('setupIncomplete')}
          </p>
          {orgSettings?.setup_completed_at && (
            <p className="text-xs opacity-80">
              {new Date(orgSettings.setup_completed_at).toLocaleDateString()}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => router.push(`/${locale}/welcome`)}
          className="rounded-md border border-current/30 px-2.5 py-1 text-xs font-medium hover:bg-current/5"
        >
          {t('rerunSetup')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('businessName')}
          </label>
          <input
            type="text"
            value={salonName}
            onChange={(e) => setSalonName(e.target.value)}
            onBlur={() => save({ salon_name: salonName })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('salonNamePlaceholder')}
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('businessType')}
          </label>
          <select
            value={businessType}
            onChange={(e) => {
              setBusinessType(e.target.value)
              save({ business_type: e.target.value })
            }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
          >
            {BUSINESS_TYPES.map((bt) => (
              <option key={bt.value} value={bt.value}>
                {locale === 'ja' ? bt.labelJa : bt.labelEn}
              </option>
            ))}
          </select>
          {profile && (
            <div className="mt-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {t('businessTypeProfile')}:
              </span>{' '}
              {profile.label} — {profile.tagline}
            </div>
          )}
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('timezone')}
          </label>
          <select
            value={timezone}
            onChange={(e) => {
              setTimezone(e.target.value)
              save({ timezone: e.target.value })
            }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground mt-1.5">
            {t('timezoneDescription')}
          </p>
        </div>
      </div>

      <div className="border-t border-border/30 pt-6">
        <h4 className="text-sm font-semibold">{t('hoursOfOperation')}</h4>
        <p className="text-xs text-muted-foreground mt-1">
          {t('hoursDescription')}
        </p>
        <div className="mt-4 space-y-2">
          {WEEKDAY_KEYS.map((dayKey) => {
            const dayHours = hours[dayKey]
            const dayLabel =
              locale === 'ja' ? DAY_LABELS[dayKey].ja : DAY_LABELS[dayKey].en
            const dayError = hoursErrors[dayKey]
            const isClosed = dayHours.openMinute === dayHours.closeMinute
            return (
              <div key={dayKey}>
                <div className="grid grid-cols-[56px_1fr_20px_1fr_72px] items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {dayLabel}
                  </span>
                  <select
                    value={dayHours.openMinute}
                    onChange={(e) =>
                      handleHoursChange(
                        dayKey,
                        'openMinute',
                        parseInt(e.target.value, 10),
                      )
                    }
                    disabled={isClosed}
                    className={`w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none disabled:opacity-50 ${
                      dayError ? 'border-destructive/60' : 'border-border'
                    }`}
                  >
                    {TIME_OPTIONS.map((minute) => (
                      <option key={`open-${dayKey}-${minute}`} value={minute}>
                        {formatMinuteOfDay(minute)}
                      </option>
                    ))}
                  </select>
                  <span className="text-center text-muted-foreground">-</span>
                  <select
                    value={dayHours.closeMinute}
                    onChange={(e) =>
                      handleHoursChange(
                        dayKey,
                        'closeMinute',
                        parseInt(e.target.value, 10),
                      )
                    }
                    disabled={isClosed}
                    className={`w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none disabled:opacity-50 ${
                      dayError ? 'border-destructive/60' : 'border-border'
                    }`}
                  >
                    {TIME_OPTIONS.map((minute) => (
                      <option key={`close-${dayKey}-${minute}`} value={minute}>
                        {formatMinuteOfDay(minute)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const next: OperatingHours = {
                        ...hours,
                        [dayKey]: isClosed
                          ? { openMinute: 540, closeMinute: 1080 }
                          : { openMinute: dayHours.openMinute, closeMinute: dayHours.openMinute },
                      }
                      setHours(next)
                      save({ operating_hours: next })
                    }}
                    className={`rounded-md border px-2 py-1.5 text-xs font-medium ${
                      isClosed
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {t('closed')}
                  </button>
                </div>
                {dayError ? (
                  <p className="mt-1 text-xs text-destructive">{dayError}</p>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className="border-t border-border/30 pt-6 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">{t('soloMode')}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('soloDescription')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const next = !soloMode
            setSoloMode(next)
            save({ solo_mode: next })
          }}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            soloMode ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              soloMode ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="border-t border-border/30 pt-6">
        <label className="text-sm font-medium mb-1.5 block">
          {t('webhookUrl')}
        </label>
        <input
          type="url"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          onBlur={() => save({ webhook_url: webhookUrl })}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="https://..."
        />
        <p className="text-xs text-muted-foreground mt-1.5">
          {t('webhookDescription')}
        </p>
      </div>

      {saving && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg">
          {tc('saving')}
        </div>
      )}
    </div>
  )
}
