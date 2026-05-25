'use client'

// SPIKE-LIFTED (visual + flow, no persistence)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/settings/CoachingSettings.tsx
//
// COACHING is Phase 3 — AI analyzes session conversations and gives
// staff growth-oriented feedback. Not shipping today. But the whole
// settings surface is scaffolded now so:
//
//   • Anthony sees the exact shape of org_settings columns + the
//     coaching_consent table needed (schema notes at bottom of file).
//   • Staff sees the surface and can preview HOW it'll work — sliders
//     drag, toggles flip, textarea accepts input (all via local
//     useState; values are NOT persisted yet).
//   • The data-model + RLS conversation happens early.
//
// One Phase-3 banner at the top of the section sets expectations
// without per-card "Coming Soon" noise — controls below match the
// spike's structure 1:1.
//
// SPIKE'S COACHING SECTIONS (replicated below in order):
//   1. コーチング機能          — master enable toggle
//   2. スタッフ間のプライバシー  — 2 cross-staff-names toggles
//   3. トップパフォーマー判定の重み — 4 weight sliders + total %
//   4. 分析の最低セッション数    — slider
//   5. 仮カルテの自動不成約期間   — slider
//   6. 同意文面テンプレート       — textarea
//   7. スタッフの同意状況        — empty state (no consent data yet)
//
// SCHEMA TODOs for Anthony's coaching-phase PR
// ────────────────────────────────────────────
//   ALTER TABLE org_settings ADD COLUMN
//     coaching_enabled bool DEFAULT false,
//     coaching_cross_staff_names_reservation bool DEFAULT true,
//     coaching_cross_staff_names_karute bool DEFAULT true,
//     coaching_weights jsonb DEFAULT
//       '{"revenue":25,"rebooking":35,"satisfaction":25,"perCustomer":15}'::jsonb,
//     coaching_min_sessions int DEFAULT 20,
//     coaching_auto_decline_days int DEFAULT 14,
//     coaching_policy_template text,
//     coaching_policy_version int DEFAULT 1;
//
//   CREATE TABLE coaching_consent (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     staff_id uuid NOT NULL REFERENCES staff(id),
//     granted_at timestamptz NOT NULL DEFAULT now(),
//     revoked_at timestamptz,
//     policy_version int NOT NULL,
//     UNIQUE (staff_id, policy_version)
//   );
//
//   -- Owners see CATEGORY-LEVEL aggregates only — never individual
//   -- conversation content. Cross-staff name visibility is org-wide
//   -- (the toggles above) and applies to ALL staff equally.
//   -- Staff revocation halts feedback immediately; historical
//   -- contributions stay in the anonymized learning corpus unless
//   -- the staff member also requests data deletion (APPI flow).

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Brain, Clock3, Eye, FileText, Sliders, Users } from 'lucide-react'

const WEIGHT_KEYS = [
  'revenue',
  'rebooking',
  'satisfaction',
  'perCustomer',
] as const
type WeightKey = (typeof WEIGHT_KEYS)[number]

const WEIGHT_DEFAULTS: Record<WeightKey, number> = {
  revenue: 25,
  rebooking: 35,
  satisfaction: 25,
  perCustomer: 15,
}

const WEIGHT_LABEL_KEYS: Record<WeightKey, string> = {
  revenue: 'weightRevenue',
  rebooking: 'weightRebooking',
  satisfaction: 'weightSatisfaction',
  perCustomer: 'weightPerCustomer',
}

export function CoachingSection() {
  const t = useTranslations('settings.coaching')

  // Local-only state. Values are NOT persisted (Phase 3 will wire to
  // org_settings columns — see header comment for the schema).
  const [masterEnabled, setMasterEnabled] = useState(true)
  const [crossReservationOn, setCrossReservationOn] = useState(false)
  const [crossKaruteOn, setCrossKaruteOn] = useState(true)
  const [weights, setWeights] = useState<Record<WeightKey, number>>(
    WEIGHT_DEFAULTS,
  )
  const [minSessions, setMinSessions] = useState(20)
  const [autoDeclineDays, setAutoDeclineDays] = useState(14)
  const [policyText, setPolicyText] = useState('')

  const weightSum = useMemo(
    () => Object.values(weights).reduce((a, b) => a + b, 0),
    [weights],
  )

  function updateWeight(key: WeightKey, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-5">
      {/* Phase-3 banner — ONE prominent notice so per-card pills
       *  aren't needed. Matches the spike's clean section layout. */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/60 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
        <Brain
          className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
          aria-hidden
        />
        <div className="text-[12px] leading-relaxed text-amber-900 dark:text-amber-200">
          {t('phaseBanner')}
        </div>
      </div>

      {/* 1. Master enable toggle */}
      <SectionCard icon={Brain} title={t('masterSectionTitle')}>
        <SettingRow
          label={t('masterEnable')}
          description={t('masterEnableDesc')}
        >
          <ToggleSwitch
            checked={masterEnabled}
            onChange={setMasterEnabled}
            onLabel={t('enabledLabel')}
            offLabel={t('disabledLabel')}
          />
        </SettingRow>
      </SectionCard>

      {/* 2. Cross-staff privacy toggles */}
      <SectionCard icon={Eye} title={t('privacySectionTitle')}>
        <SettingRow
          label={t('crossStaffReservation')}
          description={t('crossStaffReservationDesc')}
        >
          <ToggleSwitch
            checked={crossReservationOn}
            onChange={setCrossReservationOn}
            onLabel={t('shownLabel')}
            offLabel={t('hiddenLabel')}
          />
        </SettingRow>
        <div className="mt-4 border-t border-border/40 pt-4">
          <SettingRow
            label={t('crossStaffKarute')}
            description={t('crossStaffKaruteDesc')}
          >
            <ToggleSwitch
              checked={crossKaruteOn}
              onChange={setCrossKaruteOn}
              onLabel={t('shownLabel')}
              offLabel={t('hiddenLabel')}
            />
          </SettingRow>
        </div>
      </SectionCard>

      {/* 3. Top performer weights — 4 sliders + sum total */}
      <SectionCard icon={Sliders} title={t('weightsTitle')}>
        <p className="mb-4 text-xs text-muted-foreground">{t('weightsHelper')}</p>
        <div className="space-y-3">
          {WEIGHT_KEYS.map((key) => (
            <WeightSliderRow
              key={key}
              label={t(WEIGHT_LABEL_KEYS[key])}
              value={weights[key]}
              onChange={(v) => updateWeight(key, v)}
            />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3 text-xs">
          <span className="text-muted-foreground">{t('weightTotal')}</span>
          <span
            className={`font-medium tabular-nums ${
              weightSum === 100
                ? 'text-green-700 dark:text-green-300'
                : 'text-amber-700 dark:text-amber-300'
            }`}
          >
            {weightSum}%
          </span>
        </div>
      </SectionCard>

      {/* 4. Minimum sessions slider */}
      <SectionCard icon={Brain} title={t('minSessionsCardTitle')}>
        <SettingRow
          label={t('minSessionsRowLabel')}
          description={t('minSessionsRowDesc')}
        >
          <NumericSliderRow
            min={5}
            max={50}
            step={5}
            value={minSessions}
            onChange={setMinSessions}
            unitLabel={t('minSessionsUnit')}
          />
        </SettingRow>
      </SectionCard>

      {/* 5. Provisional karute auto-decline slider */}
      <SectionCard icon={Clock3} title={t('provisionalKaruteTitle')}>
        <SettingRow
          label={t('provisionalKaruteRowLabel')}
          description={t('provisionalKaruteRowDesc')}
        >
          <NumericSliderRow
            min={3}
            max={30}
            step={1}
            value={autoDeclineDays}
            onChange={setAutoDeclineDays}
            unitLabel={t('provisionalKaruteUnit')}
          />
        </SettingRow>
      </SectionCard>

      {/* 6. Consent policy template textarea */}
      <SectionCard icon={FileText} title={t('policySectionTitle')}>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          {t('policyHelper')}
        </p>
        <textarea
          value={policyText || t('policyDefault')}
          onChange={(e) => setPolicyText(e.target.value)}
          rows={5}
          className="w-full resize-y rounded-md border border-border bg-background p-3 text-sm leading-relaxed focus:border-foreground/30 focus:outline-none focus:ring-1 focus:ring-foreground/30"
        />
      </SectionCard>

      {/* 7. Staff consent status — empty state until coaching is wired */}
      <SectionCard icon={Users} title={t('consentStatusTitle')}>
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-[12px] leading-relaxed text-muted-foreground">
          {t('consentStatusEmpty')}
        </div>
      </SectionCard>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Local subcomponents — kept file-local since they're not reused
// outside coaching settings.
// ─────────────────────────────────────────────────────────────

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Brain
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border/30 bg-card/50 p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-foreground/70" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="flex justify-start">{children}</div>
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  onLabel,
  offLabel,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  onLabel: string
  offLabel: string
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked
            ? 'bg-green-600 dark:bg-green-500'
            : 'bg-gray-300 dark:bg-white/15'
        }`}
      >
        <span
          className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className="text-xs font-medium text-muted-foreground">
        {checked ? onLabel : offLabel}
      </span>
    </label>
  )
}

function WeightSliderRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (next: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-24 shrink-0 text-sm text-foreground">{label}</label>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-foreground"
      />
      <span className="w-12 shrink-0 text-right text-sm font-medium tabular-nums">
        {value}%
      </span>
    </div>
  )
}

function NumericSliderRow({
  min,
  max,
  step,
  value,
  onChange,
  unitLabel,
}: {
  min: number
  max: number
  step: number
  value: number
  onChange: (next: number) => void
  unitLabel: string
}) {
  return (
    <div className="flex w-full items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-40 max-w-full accent-foreground"
      />
      <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">
        {value}
        {unitLabel}
      </span>
    </div>
  )
}
