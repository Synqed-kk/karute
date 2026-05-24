'use client'

// ============================================================
// UPCOMING AI FEATURES — visual placeholders only
// ============================================================
// Four "Coming Soon" cards that sit between the customer identity
// card and the existing Memory/Sessions/Photos/Privacy tabs on the
// customer profile page. Mirrors the AI surface that lives on the
// design spike's karute detail page:
//
//   - AI体調予測       → spike: AIBodyPredictionCard
//   - AI推奨メッセージ  → spike: AIOutreachCard
//   - AI要約           → spike: AISummaryCard
//   - 録音・文字起こし  → spike: TranscriptCollapse
//
// Each card is visually-only — no data, no action. They're here so
// (a) Liam sees the AI roadmap reflected in the UI, (b) staff see
// what's coming so they understand the product trajectory, (c)
// Anthony has a clear handoff point per feature when he wires the
// real implementation.
//
// ANTHONY: each card below has its own inline note pointing at the
// spike source file + the AI_INTEGRATION_SPEC.md surface number +
// the expected data shape. When you wire a real implementation,
// replace the corresponding `<…Preview>` with the real component
// and add it to the existing Memory/Sessions/Photos tab structure
// or restructure the page entirely — design call.
// ============================================================

import {
  ChevronRight,
  FileText,
  Mic,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

// Individual previews are exported above (each marked `export`) so
// callers can place them in the spike's exact positions across the
// karute detail page (body prediction + outreach as a 2-col row;
// summary + transcript stacked in a desktop sidebar). The previous
// `UpcomingAiFeatures` grid wrapper is gone — the spike's
// KaruteDetailPage distributes these across different layout regions,
// not a single 4-up grid.

// ─────────────────────────────────────────────────────────────
// AI体調予測 — AI Body Condition Prediction
// ─────────────────────────────────────────────────────────────
// ANTHONY: spike source —
//   src/components/karute/AIBodyPredictionCard.tsx
// Data shape (see src/mock/karute-detail.ts → aiPrediction):
//   { headline: string
//   , confidence: number    // 0..1
//   , trendLabel: string
//   , trendDirection: 'up' | 'down' | 'stable'
//   , recommendedVisit: { window: string; weeksOut: string }
//   , rationale: string[] }
// AI integration ref: AI_INTEGRATION_SPEC.md §1 (body prediction).
// Generation cadence: nightly Sonnet pass over the customer's
// karute history; result persisted on `ai_body_prediction` table
// keyed by customer_id, with a fresh-by date so stale predictions
// can be re-generated on demand.
// ─────────────────────────────────────────────────────────────
export function AIBodyPredictionPreview() {
  const t = useTranslations('customers.profileUpcoming')
  return (
    <FeatureCard
      icon={<Sparkles size={14} />}
      accent="blue"
      titleKey="aiBodyPrediction.title"
      descriptionKey="aiBodyPrediction.description"
    >
      {/* Faux confidence bar — visual hint at the real card's content */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{t('aiBodyPrediction.title')}</span>
          <span className="tabular-nums">— %</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-blue-100 dark:bg-blue-500/10">
          <div className="h-full w-1/3 rounded-full bg-blue-300 dark:bg-blue-500/40" />
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <TrendingUp size={11} className="opacity-50" />
          <span>—</span>
        </div>
      </div>
    </FeatureCard>
  )
}

// ─────────────────────────────────────────────────────────────
// AI推奨メッセージ — AI Outreach Card
// ─────────────────────────────────────────────────────────────
// ANTHONY: spike source —
//   src/components/karute/AIOutreachCard.tsx
// Data shape (see src/mock/karute-detail.ts → aiOutreach):
//   { channel: 'LINE' | 'メール' | 'SMS'
//   , preview: string   // ~80 chars
//   , full: string }
// AI prompt: AI_PROMPTS.md §3 "Outreach Message Draft".
// Mutation surface: `sendOutreach({ karuteId, customerId, channel,
// body })` — persists to `outreach_sends`, then invokes an edge
// function that hits the channel API (LINE Messaging / Twilio /
// SES). Never call channel APIs from the client — credentials
// server-held only.
// ─────────────────────────────────────────────────────────────
export function AIOutreachPreview() {
  return (
    <FeatureCard
      icon={<ChevronRight size={14} />}
      accent="amber"
      titleKey="aiOutreach.title"
      descriptionKey="aiOutreach.description"
    >
      <div className="mt-3 flex items-center gap-1.5">
        <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          LINE
        </span>
        <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          SMS
        </span>
        <span className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          Email
        </span>
      </div>
    </FeatureCard>
  )
}

// ─────────────────────────────────────────────────────────────
// AI要約 — AI Session Summary
// ─────────────────────────────────────────────────────────────
// ANTHONY: spike source —
//   src/components/karute/AISummaryCard.tsx
// Data shape (see src/mock/karute-detail.ts → aiSummary):
//   summary: string[]   // 4-6 bullets, ~10-20 words each
// AI integration ref: AI_INTEGRATION_SPEC.md §3 (session summary).
// Trigger: post-recording, after transcript is finalized. Pipeline
// = transcript → entries extractor (§4) → summary generator (this).
// Persisted on `karute_records.ai_summary jsonb` so it survives
// re-renders and can be quoted in the AI outreach draft above.
// ─────────────────────────────────────────────────────────────
export function AISummaryPreview() {
  return (
    <FeatureCard
      icon={<FileText size={14} />}
      accent="blue"
      titleKey="aiSummary.title"
      descriptionKey="aiSummary.description"
    >
      <ul className="mt-3 space-y-1.5">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-1.5 inline-block size-1 rounded-full bg-blue-300 dark:bg-blue-500/40" />
            <span className="block h-2 flex-1 rounded bg-muted" />
          </li>
        ))}
      </ul>
    </FeatureCard>
  )
}

// ─────────────────────────────────────────────────────────────
// 録音・文字起こし — Recording & Transcript
// ─────────────────────────────────────────────────────────────
// ANTHONY: spike source —
//   src/components/karute/TranscriptCollapse.tsx
// Data shape (see src/mock/karute-detail.ts → transcript):
//   { consent: boolean
//   , consentDate: string
//   , durationLabel: string  // "12分38秒"
//   , content: string        // plain text
//   , diarizedRecordingId?: string }
// AI integration ref: AI_INTEGRATION_SPEC.md §6 (transcript +
// diarization). Audio storage: Supabase Storage bucket
// `recordings/{customer_id}/{karute_id}.m4a`. Transcript +
// diarized version persisted on `karute_records.transcript` /
// `recordings.diarized_transcript`. Consent badge derives from
// `customers.recording_consent`.
//
// NATIVE INTEGRATION: audio playback should be native via
// Capacitor — see docs/CAPACITOR_MIGRATION_PLAN.md.
// ─────────────────────────────────────────────────────────────
export function RecordingTranscriptPreview() {
  return (
    <FeatureCard
      icon={<Mic size={14} />}
      accent="rose"
      titleKey="recordingTranscript.title"
      descriptionKey="recordingTranscript.description"
    >
      {/* Mock waveform suggestion */}
      <div className="mt-3 flex h-6 items-center gap-0.5">
        {[3, 5, 7, 4, 6, 8, 5, 3, 4, 6, 7, 5, 4, 6, 3, 5, 4, 6, 5, 4].map(
          (h, i) => (
            <span
              key={i}
              className="w-0.5 rounded-full bg-rose-200 dark:bg-rose-500/30"
              style={{ height: `${h * 3}px` }}
            />
          ),
        )}
      </div>
    </FeatureCard>
  )
}

// ─────────────────────────────────────────────────────────────
// Shared chrome — one container so every card reads the same
// ─────────────────────────────────────────────────────────────
type Accent = 'blue' | 'amber' | 'rose'

const ACCENT_CLASSES: Record<
  Accent,
  { ring: string; iconBg: string; iconText: string; label: string }
> = {
  blue: {
    ring: 'border-blue-200/60 dark:border-blue-500/20',
    iconBg: 'bg-blue-600 dark:bg-blue-500/80',
    iconText: 'text-white',
    label: 'text-blue-700 dark:text-blue-300',
  },
  amber: {
    ring: 'border-amber-200/60 dark:border-amber-500/20',
    iconBg: 'bg-amber-500 dark:bg-amber-500/80',
    iconText: 'text-white',
    label: 'text-amber-700 dark:text-amber-300',
  },
  rose: {
    ring: 'border-rose-200/60 dark:border-rose-500/20',
    iconBg: 'bg-rose-500 dark:bg-rose-500/80',
    iconText: 'text-white',
    label: 'text-rose-700 dark:text-rose-300',
  },
}

function FeatureCard({
  icon,
  accent,
  titleKey,
  descriptionKey,
  children,
}: {
  icon: React.ReactNode
  accent: Accent
  titleKey: string
  descriptionKey: string
  children?: React.ReactNode
}) {
  const t = useTranslations('customers.profileUpcoming')
  const a = ACCENT_CLASSES[accent]
  return (
    <article
      // Mobile: flat edge-to-edge section with a bottom border (no
      // rounded corners, no ring). Desktop: full card chrome — ring +
      // soft accent border + rounded corners. Matches the spike's
      // pattern where AI cards render flat on mobile + ringed on desktop.
      className={`relative flex flex-col gap-1 bg-card/60 p-4 border-b border-black/5 dark:border-white/5 md:border-b-0 md:rounded-2xl md:border md:${a.ring}`}
    >
      {/* "対応予定" pill in the top-right corner */}
      <span className="absolute right-3 top-3 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
        {t('sectionLabel')}
      </span>

      <div className="flex items-center gap-2">
        <span
          className={`inline-flex size-6 items-center justify-center rounded-full ${a.iconBg} ${a.iconText}`}
          aria-hidden
        >
          {icon}
        </span>
        <span
          className={`text-[11px] font-semibold uppercase tracking-wider ${a.label}`}
        >
          {t(titleKey)}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(descriptionKey)}
      </p>

      {children}
    </article>
  )
}
