'use client'

// SPIKE-LIFTED SCAFFOLD (visible structure, no live state)
//   spike src: /Users/liam/Documents/synqed-karute-design-spike/src/components/settings/CoachingSettings.tsx
//
// COACHING is a Phase 3-ish feature: AI analyzes session conversations
// and gives staff growth-oriented feedback. It's NOT shipping in MVP.
// But Liam wants the scaffold in place NOW so:
//
//   1. Anthony sees what settings will exist (no guesswork at wire-up time)
//   2. Staff sees the surface so it's not a surprise when it ships
//   3. The data model + RLS conversation happens early (this section
//      doc-comments the table shape + access rules)
//
// Every control here is intentionally a VISIBLE PLACEHOLDER — no real
// state, no persistence, no AI calls. The "対応予定（フェーズ3）" pill
// makes the status explicit. Staff can read what's planned without
// being misled into thinking the feature works today.
//
// SPIKE'S COACHING CONTRACT (reproduced inline for Anthony's reference):
//
//   DATA SOURCE: org-level coaching settings — new table or columns
//     on org_settings. Metric weights + minimum session threshold +
//     master enable/disable + auto-decline window.
//   ACCESS LAYER: owner settings. Writes restricted to owner role.
//   AI CALLS: weights feed the top-performer ranker server-side
//     (filters which sessions are used as training examples for the
//     "what works" extractor).
//   REAL-TIME: no (settings only read at job-time).
//   STAFF CONSENT: per-staff opt-in, recorded in a separate table
//     coaching_consent (staff_id, granted_at, revoked_at, policy_version).
//     Staff can revoke any time; revocation halts feedback for that
//     staff member but keeps their historical contributions in the
//     learning corpus (anonymized) unless they also request data
//     deletion (APPI flow).
//   PRIVACY: owners see CATEGORY-LEVEL aggregates only, not individual
//     conversation content. Cross-staff name visibility is a separate
//     toggle (default off) — anonymized view by default.
//
// SCHEMA TODOs (for Anthony's coaching-phase PR):
//   ALTER TABLE org_settings ADD:
//     coaching_enabled bool DEFAULT false,
//     coaching_weights jsonb DEFAULT '{"revenue":25,"rebooking":35,"satisfaction":25,"perCustomer":15}'::jsonb,
//     coaching_min_sessions int DEFAULT 20,
//     coaching_auto_decline_days int DEFAULT 14,
//     coaching_policy_template text,
//     coaching_show_cross_staff_names bool DEFAULT false,
//     coaching_show_cross_staff_names_karute bool DEFAULT false;
//
//   CREATE TABLE coaching_consent (
//     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//     staff_id uuid NOT NULL REFERENCES staff(id),
//     granted_at timestamptz NOT NULL DEFAULT now(),
//     revoked_at timestamptz,
//     policy_version int NOT NULL,
//     UNIQUE (staff_id, policy_version)
//   );

import { useTranslations } from 'next-intl'
import {
  Brain,
  Eye,
  FileText,
  Lock,
  Sliders,
  Users,
} from 'lucide-react'

export function CoachingSection() {
  const t = useTranslations('settings.coaching')

  return (
    <div className="space-y-5">
      {/* Intro — explains what coaching IS + its current Phase 3
       *  status. Sets expectations before scaffolding shows. */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/60 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
        <Brain className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
        <div className="text-[12px] leading-relaxed text-amber-900 dark:text-amber-200">
          {t('intro')}
        </div>
      </div>

      {/* 1. Master toggle */}
      <ScaffoldCard
        icon={Brain}
        title={t('masterEnable')}
        description={t('masterEnableDesc')}
        phaseLabel={t('comingPhase')}
      />

      {/* 2. Metric weights — 4 sliders that sum to 100% */}
      <ScaffoldCard
        icon={Sliders}
        title={t('weightsTitle')}
        description={t('weightsDesc')}
        phaseLabel={t('comingPhase')}
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
          <WeightPreview label={t('weightRevenue')} percent={25} />
          <WeightPreview label={t('weightRebooking')} percent={35} />
          <WeightPreview label={t('weightSatisfaction')} percent={25} />
          <WeightPreview label={t('weightPerCustomer')} percent={15} />
        </div>
      </ScaffoldCard>

      {/* 3. Minimum sessions threshold */}
      <ScaffoldCard
        icon={Sliders}
        title={t('minSessionsLabel')}
        description={t('minSessionsDesc')}
        phaseLabel={t('comingPhase')}
      >
        <InputPreview placeholder="20" suffix="sessions" />
      </ScaffoldCard>

      {/* 4. Auto-decline window */}
      <ScaffoldCard
        icon={Sliders}
        title={t('autoDeclineLabel')}
        description={t('autoDeclineDesc')}
        phaseLabel={t('comingPhase')}
      >
        <InputPreview placeholder="14" suffix="days" />
      </ScaffoldCard>

      {/* 5. Privacy policy template (textarea) */}
      <ScaffoldCard
        icon={FileText}
        title={t('policyTitle')}
        description={t('policyDesc')}
        phaseLabel={t('comingPhase')}
      />

      {/* 6. Staff consent status list */}
      <ScaffoldCard
        icon={Users}
        title={t('consentStatusTitle')}
        description={t('consentStatusDesc')}
        phaseLabel={t('comingPhase')}
      />

      {/* 7. Cross-staff name visibility */}
      <ScaffoldCard
        icon={Eye}
        title={t('crossStaffNamesTitle')}
        description={t('crossStaffNamesDesc')}
        phaseLabel={t('comingPhase')}
      />

      {/* Privacy floor reminder */}
      <div className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
        <span>
          Owners see CATEGORY-LEVEL aggregates only — never individual
          conversation content. Staff revocation halts feedback
          immediately. APPI-compliant by design.
        </span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Reusable scaffold card — icon + title + description + Phase 3
// pill on the right. Optional children render a preview of what
// the actual control will look like.
// ─────────────────────────────────────────────────────────────
function ScaffoldCard({
  icon: Icon,
  title,
  description,
  phaseLabel,
  children,
}: {
  icon: typeof Brain
  title: string
  description: string
  phaseLabel: string
  children?: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border/30 bg-card/50 p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 text-[9px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
          {phaseLabel}
        </span>
      </div>
      {children && (
        <div className="mt-3 rounded-md bg-muted/30 p-3 opacity-60">
          {children}
        </div>
      )}
    </section>
  )
}

// Preview of a weighted slider — visual only, no interactive control.
function WeightPreview({ label, percent }: { label: string; percent: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/30"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

// Preview of a numeric input — visual only, not editable.
function InputPreview({
  placeholder,
  suffix,
}: {
  placeholder: string
  suffix: string
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 w-20 items-center justify-center rounded-md border border-border bg-background text-sm tabular-nums text-muted-foreground">
        {placeholder}
      </div>
      <span className="text-xs text-muted-foreground">{suffix}</span>
    </div>
  )
}
