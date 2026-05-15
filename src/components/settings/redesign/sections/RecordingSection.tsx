'use client'

import { useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  upsertOrgSettings,
  type OrgSettings,
  type AudioSource,
  type RecordingDisclosureMode,
} from '@/actions/org-settings'

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

const AUDIO_SOURCES: { value: AudioSource; labelKey: string }[] = [
  { value: 'phone', labelKey: 'audioSourcePhone' },
  { value: 'bluetooth', labelKey: 'audioSourceBluetooth' },
  { value: 'wired', labelKey: 'audioSourceWired' },
]

const DISCLOSURE_MODES: { value: RecordingDisclosureMode; labelKey: string }[] = [
  { value: 'A', labelKey: 'disclosureModeA' },
  { value: 'B', labelKey: 'disclosureModeB' },
  { value: 'C', labelKey: 'disclosureModeC' },
]

interface RecordingSectionProps {
  orgSettings: OrgSettings | null
}

export function RecordingSection({ orgSettings }: RecordingSectionProps) {
  const t = useTranslations('settings')
  const [audioQuality, setAudioQuality] = useState(
    orgSettings?.audio_quality ?? 'standard',
  )
  const [autoStop, setAutoStop] = useState(
    orgSettings?.auto_stop_minutes ?? 30,
  )
  const [audioSource, setAudioSource] = useState<AudioSource>(
    orgSettings?.audio_source ?? 'phone',
  )
  const [noiseSuppression, setNoiseSuppression] = useState(
    orgSettings?.noise_suppression ?? true,
  )
  const [diarization, setDiarization] = useState(
    orgSettings?.speaker_diarization ?? true,
  )
  const [voiceRecognition, setVoiceRecognition] = useState(
    orgSettings?.voice_recognition_improved ?? false,
  )
  const [disclosureMode, setDisclosureMode] = useState<RecordingDisclosureMode>(
    orgSettings?.recording_disclosure_mode ?? 'B',
  )
  const [privacyConfirmed, setPrivacyConfirmed] = useState(
    orgSettings?.recording_disclosure_privacy_confirmed ?? false,
  )
  const [consentRequired, setConsentRequired] = useState(
    orgSettings?.recording_consent_required ?? false,
  )
  const [consentTemplate, setConsentTemplate] = useState(
    orgSettings?.recording_consent_template ?? '',
  )

  const save = useCallback(
    async (partial: Partial<OrgSettings>, quiet = false) => {
      const result = await upsertOrgSettings(partial)
      if ('error' in result) toast.error(result.error)
      else if (!quiet) toast.success(t('settingsSaved'))
    },
    [t],
  )

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t('recordingSettings')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('recordingDescription')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('audioQuality')}
          </label>
          <select
            value={audioQuality}
            onChange={(e) => {
              setAudioQuality(e.target.value)
              save({ audio_quality: e.target.value })
            }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
          >
            {AUDIO_QUALITY.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('autoStop')}
          </label>
          <select
            value={autoStop}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              setAutoStop(v)
              save({ auto_stop_minutes: v })
            }}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
          >
            {AUTO_STOP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border-t border-border/30 pt-6">
        <label className="text-sm font-medium mb-1.5 block">
          {t('audioSource')}
        </label>
        <div className="grid grid-cols-3 gap-2">
          {AUDIO_SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => {
                setAudioSource(s.value)
                save({ audio_source: s.value })
              }}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                audioSource === s.value
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {t(s.labelKey)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          {t('audioSourceDescription')}
        </p>
      </div>

      <div className="border-t border-border/30 pt-6 space-y-4">
        <Toggle
          label={t('noiseSuppression')}
          description={t('noiseSuppressionDescription')}
          value={noiseSuppression}
          onChange={(v) => {
            setNoiseSuppression(v)
            save({ noise_suppression: v })
          }}
        />
        <Toggle
          label={t('speakerSeparation')}
          description={t('speakerSeparationDescription')}
          value={diarization}
          onChange={(v) => {
            setDiarization(v)
            save({ speaker_diarization: v })
          }}
        />
        <Toggle
          label={t('voiceRecognition')}
          description={t('voiceRecognitionDescription')}
          value={voiceRecognition}
          onChange={(v) => {
            setVoiceRecognition(v)
            save({ voice_recognition_improved: v })
          }}
          comingSoon={t('comingSoon')}
        />
      </div>

      <div className="border-t border-border/30 pt-6">
        <label className="text-sm font-medium mb-1.5 block">
          {t('recordingDisclosure')}
        </label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {DISCLOSURE_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => {
                setDisclosureMode(m.value)
                save({ recording_disclosure_mode: m.value })
              }}
              className={`rounded-lg border px-3 py-2 text-sm font-medium text-left transition-colors ${
                disclosureMode === m.value
                  ? 'border-foreground bg-foreground/5'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {t(m.labelKey)}
            </button>
          ))}
        </div>

        {disclosureMode === 'A' && (
          <label className="flex items-start gap-2 mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={privacyConfirmed}
              onChange={(e) => {
                setPrivacyConfirmed(e.target.checked)
                save({ recording_disclosure_privacy_confirmed: e.target.checked })
              }}
              className="mt-0.5"
            />
            <span className="text-sm text-foreground">
              {t('privacyPolicyConfirmed')}
            </span>
          </label>
        )}

        {disclosureMode === 'C' && (
          <div className="mt-4 space-y-3">
            <Toggle
              label={t('consentRequired')}
              description={t('consentRequiredDescription')}
              value={consentRequired}
              onChange={(v) => {
                setConsentRequired(v)
                save({ recording_consent_required: v })
              }}
            />
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                {t('consentTemplate')}
              </label>
              <textarea
                value={consentTemplate}
                onChange={(e) => setConsentTemplate(e.target.value)}
                onBlur={() =>
                  save({ recording_consent_template: consentTemplate })
                }
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={t('consentTemplatePlaceholder')}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Toggle({
  label,
  description,
  value,
  onChange,
  comingSoon,
}: {
  label: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
  comingSoon?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex-1 min-w-0 pr-4">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{label}</p>
          {comingSoon && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {comingSoon}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          value ? 'bg-primary' : 'bg-muted'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
            value ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}
