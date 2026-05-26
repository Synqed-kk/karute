'use client'

import { useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import {
  upsertOrgSettings,
  type OrgSettings,
  type AIVoiceStyle,
} from '@/actions/org-settings'

const AI_MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini (Fast)' },
  { value: 'gpt-4o', label: 'GPT-4o (Best)' },
  { value: 'claude-haiku', label: 'Claude Haiku 4.5' },
  { value: 'claude-sonnet', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus', label: 'Claude Opus 4.7' },
]

const VOICE_STYLES: { value: AIVoiceStyle; labelKey: string }[] = [
  { value: 'formal', labelKey: 'aiVoiceStyleFormal' },
  { value: 'polite', labelKey: 'aiVoiceStylePolite' },
  { value: 'friendly', labelKey: 'aiVoiceStyleFriendly' },
]

interface AISectionProps {
  orgSettings: OrgSettings | null
}

export function AISection({ orgSettings }: AISectionProps) {
  const t = useTranslations('settings')
  const [aiModel, setAiModel] = useState(orgSettings?.ai_model ?? 'gpt-4o-mini')
  const [threshold, setThreshold] = useState(
    orgSettings?.confidence_threshold ?? 0.7,
  )
  const [autoSummary, setAutoSummary] = useState(
    orgSettings?.ai_auto_summary ?? true,
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
        <h3 className="text-lg font-semibold">{t('aiSettings')}</h3>
        <p className="text-sm text-muted-foreground">{t('aiDescription')}</p>
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">{t('aiModel.label')}</label>
        <select
          value={aiModel}
          onChange={(e) => {
            setAiModel(e.target.value)
            save({ ai_model: e.target.value })
          }}
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none"
        >
          {AI_MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="border-t border-border/30 pt-6">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium">
            {t('confidenceThreshold')}
          </label>
          <span className="text-sm font-mono text-muted-foreground">
            {threshold.toFixed(1)}
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          onMouseUp={() => save({ confidence_threshold: threshold })}
          onTouchEnd={() => save({ confidence_threshold: threshold })}
          className="w-full h-2 rounded-full appearance-none bg-muted cursor-pointer accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>0</span>
          <span>0.5</span>
          <span>1.0</span>
        </div>
      </div>

      <div className="border-t border-border/30 pt-6 space-y-4">
        <Toggle
          label={t('aiAutoSummary')}
          description={t('aiAutoSummaryDescription')}
          value={autoSummary}
          onChange={(v) => {
            setAutoSummary(v)
            save({ ai_auto_summary: v })
          }}
        />
        <Toggle
          label={t('aiAutoOutreach')}
          description={t('aiAutoOutreachDescription')}
          value={false}
          onChange={() => {}}
          disabled
          comingSoon={t('comingSoon')}
        />
      </div>

      <div className="border-t border-border/30 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{t('aiVoiceStyle')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('aiVoiceStyleDescription')}
            </p>
          </div>
          <span
            className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            title={t('comingSoon')}
          >
            {t('comingSoon')}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3 opacity-50 pointer-events-none">
          {VOICE_STYLES.map((s) => (
            <button
              key={s.value}
              type="button"
              disabled
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground"
            >
              {t(s.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-border/30 pt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
        <V2Card label={t('aiCustomizeProfile')} description={t('aiCustomizeProfileDescription')} badge={t('comingInV2')} />
        <V2Card label={t('aiIntakeForms')} description={t('aiIntakeFormsDescription')} badge={t('comingInV2')} />
      </div>
    </div>
  )
}

function Toggle({
  label,
  description,
  value,
  onChange,
  disabled,
  comingSoon,
}: {
  label: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  comingSoon?: string
}) {
  return (
    <div className={`flex items-center justify-between ${disabled ? 'opacity-60' : ''}`}>
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
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
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

function V2Card({
  label,
  description,
  badge,
}: {
  label: string
  description: string
  badge: string
}) {
  return (
    <div className="rounded-lg border border-dashed border-border/40 bg-card/30 p-4 opacity-70">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="size-4 text-muted-foreground shrink-0" />
          <p className="text-sm font-medium truncate">{label}</p>
        </div>
        <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
          {badge}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{description}</p>
    </div>
  )
}
