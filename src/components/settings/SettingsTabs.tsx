'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { upsertOrgSettings, type OrgSettings } from '@/actions/org-settings'
import { StaffList } from '@/components/staff/StaffList'
import type { StaffMember } from '@/lib/staff'
import {
  type OperatingHours,
  type WeekdayKey,
  WEEKDAY_KEYS,
  DEFAULT_OPERATING_HOURS,
  formatMinuteOfDay,
  normalizeOperatingHours,
  validateDailyOperatingHours,
} from '@/lib/operating-hours'

interface SettingsTabsProps {
  orgSettings: OrgSettings | null
  staffList: StaffMember[]
  activeStaffId: string | null
  locale: string
}

const BUSINESS_TYPES = [
  { value: 'hair_salon', label: '✂️ Hair Salon', labelJa: '✂️ ヘアサロン' },
  { value: 'esthetic', label: '💆 Esthetic Salon', labelJa: '💆 エステサロン' },
  { value: 'chiropractic', label: '💪 Chiropractic', labelJa: '💪 整体・整骨院' },
  { value: 'beauty_bodywork', label: '✨ Beauty Bodywork', labelJa: '✨ 美容整体' },
  { value: 'beauty_clinic', label: '💉 Beauty Clinic', labelJa: '💉 美容クリニック' },
  { value: 'medical_clinic', label: '🏥 Medical Clinic', labelJa: '🏥 内科・クリニック' },
  { value: 'dental', label: '🦷 Dental', labelJa: '🦷 歯科' },
  { value: 'gym_pt', label: '🏋️ Gym / PT', labelJa: '🏋️ ジム・PT' },
  { value: 'nail_salon', label: '💅 Nail Salon', labelJa: '💅 ネイルサロン' },
  { value: 'eye_salon', label: '👁️ Eye Salon', labelJa: '👁️ アイサロン' },
  { value: 'yoga_pilates', label: '🧘 Yoga / Pilates', labelJa: '🧘 ヨガ・ピラティス' },
  { value: 'pet_salon', label: '🐾 Pet Salon', labelJa: '🐾 ペットサロン' },
  { value: 'other', label: '🏢 Other', labelJa: '🏢 その他' },
]

const AI_MODELS = [
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini (Fast)' },
  { value: 'gpt-4o', label: 'gpt-4o (Best)' },
]

const AUDIO_QUALITY = [
  { value: 'low', label: 'Low' },
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'High' },
]

const AUTO_STOP_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
  { value: 0, label: 'Off' },
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

type TabId = 'organization' | 'ai' | 'recording' | 'staff'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'organization', label: 'Organization', icon: '🏢' },
  { id: 'ai', label: 'AI Settings', icon: '🧠' },
  { id: 'recording', label: 'Recording Settings', icon: '🎙️' },
  { id: 'staff', label: 'Staff Management', icon: '👥' },
]

export function SettingsTabs({ orgSettings, staffList, activeStaffId, locale }: SettingsTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('organization')
  const initialOperatingHours = normalizeOperatingHours(orgSettings?.operating_hours ?? DEFAULT_OPERATING_HOURS)
  const [settings, setSettings] = useState({
    salon_name: orgSettings?.salon_name ?? '',
    business_type: orgSettings?.business_type ?? 'other',
    webhook_url: orgSettings?.webhook_url ?? '',
    ai_model: orgSettings?.ai_model ?? 'gpt-4o-mini',
    confidence_threshold: orgSettings?.confidence_threshold ?? 0.7,
    audio_quality: orgSettings?.audio_quality ?? 'standard',
    auto_stop_minutes: orgSettings?.auto_stop_minutes ?? 30,
    operating_hours: initialOperatingHours,
  })
  const [saving, setSaving] = useState(false)
  const [hoursErrors, setHoursErrors] = useState<Partial<Record<WeekdayKey, string>>>({})

  const handleSave = useCallback(async (partial: Partial<typeof settings>) => {
    setSaving(true)
    const updated = { ...settings, ...partial }
    setSettings(updated)
    const result = await upsertOrgSettings(updated)
    if ('error' in result) {
      toast.error(result.error)
    } else {
      toast.success('Settings saved')
    }
    setSaving(false)
  }, [settings])

  const handleOperatingHourChange = useCallback(async (
    dayKey: WeekdayKey,
    field: 'openMinute' | 'closeMinute',
    value: number
  ) => {
    const nextHours: OperatingHours = {
      ...settings.operating_hours,
      [dayKey]: {
        ...settings.operating_hours[dayKey],
        [field]: value,
      },
    }

    setSettings((prev) => ({ ...prev, operating_hours: nextHours }))

    const error = validateDailyOperatingHours(nextHours[dayKey])
    setHoursErrors((prev) => {
      const next = { ...prev }
      if (error) {
        next[dayKey] = error
      } else {
        delete next[dayKey]
      }
      return next
    })

    if (error) return
    await handleSave({ operating_hours: nextHours })
  }, [handleSave, settings.operating_hours])

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-0 rounded-xl border border-border/30 bg-muted/30 p-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-w-fit whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-foreground text-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-xl border border-border/30 bg-card/50 p-6">

        {/* Organization */}
        {activeTab === 'organization' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold">Organization</h3>
              <p className="text-sm text-muted-foreground">View organization details</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Salon Name</label>
                <input
                  type="text"
                  value={settings.salon_name}
                  onChange={(e) => setSettings((s) => ({ ...s, salon_name: e.target.value }))}
                  onBlur={() => handleSave({ salon_name: settings.salon_name })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Your salon name..."
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Business Type</label>
                <select
                  value={settings.business_type}
                  onChange={(e) => handleSave({ business_type: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
                >
                  {BUSINESS_TYPES.map((bt) => (
                    <option key={bt.value} value={bt.value}>
                      {locale === 'ja' ? bt.labelJa : bt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="border-t border-border/30 pt-6">
              <div>
                <h4 className="text-sm font-semibold">Hours of operation</h4>
                <p className="text-xs text-muted-foreground mt-1">Set open and close times for each day.</p>
              </div>
              <div className="mt-4 space-y-2">
                {WEEKDAY_KEYS.map((dayKey) => {
                  const dayHours = settings.operating_hours[dayKey]
                  const dayLabel = locale === 'ja' ? DAY_LABELS[dayKey].ja : DAY_LABELS[dayKey].en
                  const dayError = hoursErrors[dayKey]
                  return (
                    <div key={dayKey}>
                      <div className="grid grid-cols-[56px_1fr_20px_1fr] items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{dayLabel}</span>
                        <select
                          value={dayHours.openMinute}
                          onChange={(e) => handleOperatingHourChange(dayKey, 'openMinute', parseInt(e.target.value, 10))}
                          className={`w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none ${
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
                          onChange={(e) => handleOperatingHourChange(dayKey, 'closeMinute', parseInt(e.target.value, 10))}
                          className={`w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none ${
                            dayError ? 'border-destructive/60' : 'border-border'
                          }`}
                        >
                          {TIME_OPTIONS.map((minute) => (
                            <option key={`close-${dayKey}-${minute}`} value={minute}>
                              {formatMinuteOfDay(minute)}
                            </option>
                          ))}
                        </select>
                      </div>
                      {dayError ? (
                        <p className="mt-1 text-xs text-destructive">{dayError}</p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="border-t border-border/30 pt-6">
              <label className="text-sm font-medium mb-1.5 block">Webhook URL</label>
              <input
                type="url"
                value={settings.webhook_url}
                onChange={(e) => setSettings((s) => ({ ...s, webhook_url: e.target.value }))}
                onBlur={() => handleSave({ webhook_url: settings.webhook_url })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="https://..."
              />
              <p className="text-xs text-muted-foreground mt-1.5">POSTs to this URL when a karute is created.</p>
            </div>

            <p className="text-xs text-muted-foreground border-t border-border/30 pt-4">
              AI classification categories will automatically adjust based on the business type.
            </p>
          </div>
        )}

        {/* AI Settings */}
        {activeTab === 'ai' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold">AI Settings</h3>
              <p className="text-sm text-muted-foreground">Manage AI processing preferences</p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Preferred AI Model</label>
              <select
                value={settings.ai_model}
                onChange={(e) => handleSave({ ai_model: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
              >
                {AI_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="border-t border-border/30 pt-6">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">Classification Confidence Threshold</label>
                <span className="text-sm font-mono text-muted-foreground">{settings.confidence_threshold.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.confidence_threshold}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  setSettings((s) => ({ ...s, confidence_threshold: val }))
                }}
                onMouseUp={() => handleSave({ confidence_threshold: settings.confidence_threshold })}
                onTouchEnd={() => handleSave({ confidence_threshold: settings.confidence_threshold })}
                className="w-full h-2 rounded-full appearance-none bg-muted cursor-pointer accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>0</span>
                <span>0.5</span>
                <span>1.0</span>
              </div>
            </div>
          </div>
        )}

        {/* Recording Settings */}
        {activeTab === 'recording' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold">Recording Settings</h3>
              <p className="text-sm text-muted-foreground">Configure recording quality and behavior</p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Audio Quality</label>
              <select
                value={settings.audio_quality}
                onChange={(e) => handleSave({ audio_quality: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
              >
                {AUDIO_QUALITY.map((q) => (
                  <option key={q.value} value={q.value}>{q.label}</option>
                ))}
              </select>
            </div>

            <div className="border-t border-border/30 pt-6">
              <label className="text-sm font-medium mb-1.5 block">Auto-Stop Timer (minutes)</label>
              <select
                value={settings.auto_stop_minutes}
                onChange={(e) => handleSave({ auto_stop_minutes: parseInt(e.target.value) })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
              >
                {AUTO_STOP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Staff Management */}
        {activeTab === 'staff' && (
          <div className="space-y-4">
            <StaffList staffList={staffList} activeStaffId={activeStaffId} />
          </div>
        )}

      </div>

      {saving && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg animate-in fade-in-0 duration-200">
          Saving...
        </div>
      )}
    </div>
  )
}
