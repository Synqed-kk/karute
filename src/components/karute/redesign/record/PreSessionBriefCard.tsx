'use client'

// LIFTED FROM SPIKE (visual + flow)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/record/PreSessionBriefCard.tsx
//
// SESSION前ブリーフィング card — shown above the record button on the
// /sessions page. Two render modes, both matching the spike:
//
//   1. FIRST-VISIT (isFirstTimeVisit=true)
//      Sparkles header + "初めてのお客様" label + warm framing copy
//      ("{name}様は本日が初めて..."). Optional reservation memo block
//      (amber) below if the customer left a booking note.
//
//   2. RETURNING (default)
//      Sparkles header + "セッション前ブリーフィング" label + last-visit
//      date ("前回 2026-03-22 (28日前)"). Sections (only render when
//      data exists):
//        • Reservation memo (amber) — customer's own words at booking
//        • Conversation hooks (PawPrint icon) — small-talk material
//        • Last concerns (Clock3) — recap of prior session's clinical notes
//        • Last product offered (Gift) — what was proposed last visit
//        • Recommended focus today (Target) — AI's suggested angle
//
// DATA SOURCE
//   Today: derived mechanically in sessions/page.tsx's
//   buildPreSessionBriefFor() from the customer's last karute_records
//   + entries.
//
//   Tomorrow (Anthony's function branch): replace the derivation with
//   a read from a new `pre_session_briefs` table or jsonb column on
//   appointments, populated nightly by an AI batch job. Spec lives
//   in spike's PreSessionBriefCard header comment ("AI_PROMPTS.md §15
//   — to be added"). Brief format below is the contract.
//
// PRIVACY POSTURE (from spike header)
//   Mostly Layer 2 (recap + product reaction). `personalNotes` (the
//   conversation hooks below) are treated as Layer 1 (staff-private)
//   and gated through the same cross-staff privacy toggle as the
//   karute list. ANTHONY: enforce the cross-staff visibility check
//   server-side when wiring the real `pre_session_briefs` read.

import { useTranslations } from 'next-intl'
import { Clock, Gift, PawPrint, Quote, Sparkles, Target, Wand2 } from 'lucide-react'

export interface PreSessionBrief {
  /** True = first-ever visit for this customer → render the warm-
   *  intro framing instead of the recap. */
  isFirstTimeVisit?: boolean
  /** Pre-formatted "2026年3月22日" or "Mar 22, 2026". Empty when
   *  isFirstTimeVisit=true (we don't have a last visit to show). */
  lastVisitDate: string
  /** Pre-formatted "28日前" or "28d ago". Empty for first-visit. */
  lastVisitAgo: string
  /** Conversation hooks — small-talk material the AI extracted +
   *  staff confirmed. Empty for first-time visits. */
  hooks: { title: string; body: string | null }[]
  /** Last session's clinical concerns — symptom + treatment recap. */
  concerns: string[]
  /** Last product offered + customer's reaction (if known). */
  lastProduct: { name: string; reaction: string | null } | null
  /** AI-suggested focus for today's session. */
  recommendedFocus: string | null
  /** Customer's own booking-time memo. Rendered verbatim (not AI-
   *  paraphrased) in an amber block so staff sees exactly what
   *  the customer wrote. Null when no memo. */
  reservationMemo?: string | null
}

interface PreSessionBriefCardProps {
  brief: PreSessionBrief | null
  /** Customer name — used by the first-visit framing copy. */
  customerName?: string | null
}

export function PreSessionBriefCard({
  brief,
  customerName,
}: PreSessionBriefCardProps) {
  const t = useTranslations('recording.brief')
  if (!brief) return null

  // FIRST-VISIT FRAMING — gradient blue card with warm intro copy.
  // Matches the spike's first-visit branch (no recap sections; just
  // an explainer + optional reservation memo).
  if (brief.isFirstTimeVisit) {
    return (
      <section className="rounded-2xl bg-gradient-to-br from-blue-50/60 via-card to-card p-4 ring-1 ring-blue-100 dark:from-blue-500/10 dark:via-card dark:to-card dark:ring-blue-500/20 md:p-5">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
            <Sparkles className="size-3.5" aria-hidden />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
            {t('firstTimeHeader')}
          </span>
        </div>
        <p className="text-[14px] leading-relaxed text-foreground/90">
          {t('firstTimeBody', { name: customerName ?? '' })}
        </p>
        {brief.reservationMemo && (
          <>
            <MemoBlock memo={brief.reservationMemo} label={t('reservationMemo')} className="mt-4" />
            <AiCapabilityHint
              label={t('aiHintLabel')}
              body={t('aiHintMemoAnalysis')}
              className="mt-2"
            />
          </>
        )}
        {/* No memo? Surface the same AI capability hint so staff
         *  knows what'll fill this gap once customers leave booking
         *  notes (or once we wire that field in the booking form). */}
        {!brief.reservationMemo && (
          <AiCapabilityHint
            label={t('aiHintLabel')}
            body={t('aiHintNoMemo')}
            className="mt-4"
          />
        )}
      </section>
    )
  }

  // RETURNING-VISIT FRAMING — recap card with all sections.
  return (
    <section className="rounded-2xl bg-gradient-to-br from-blue-50/60 via-card to-card p-4 ring-1 ring-blue-100 dark:from-blue-500/10 dark:via-card dark:to-card dark:ring-blue-500/20 md:p-5">
      {/* Header — Sparkles icon + label + last-visit subtitle */}
      <header className="mb-3 flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
          <Sparkles className="size-3.5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
            {t('title')}
          </div>
          {brief.lastVisitDate && (
            <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
              {t('lastVisitInline', {
                date: brief.lastVisitDate,
                ago: brief.lastVisitAgo,
              })}
            </div>
          )}
        </div>
      </header>

      {/* Reservation memo — surface FIRST when present (it's literal
       *  customer text for THIS visit, not AI-synthesized history).
       *  Most relevant hook staff should open with. */}
      {brief.reservationMemo ? (
        <>
          <MemoBlock memo={brief.reservationMemo} label={t('reservationMemo')} className="mb-2" />
          <AiCapabilityHint
            label={t('aiHintLabel')}
            body={t('aiHintMemoAnalysis')}
            className="mb-4"
          />
        </>
      ) : (
        <AiCapabilityHint
          label={t('aiHintLabel')}
          body={t('aiHintNoMemo')}
          className="mb-4"
        />
      )}

      {/* Conversation hooks — most actionable, surface near top */}
      {brief.hooks.length > 0 ? (
        <BriefSection icon={<PawPrint className="size-3" />} title={t('hooks')}>
          <ul className="space-y-1">
            {brief.hooks.map((h, i) => (
              <li
                key={i}
                className="flex gap-2 text-[14px] leading-relaxed text-foreground/90"
              >
                <span className="mt-0.5 shrink-0 text-blue-400">•</span>
                <span>
                  <span className="font-medium">{h.title}</span>
                  {h.body && <span className="text-muted-foreground"> — {h.body}</span>}
                </span>
              </li>
            ))}
          </ul>
        </BriefSection>
      ) : (
        <BriefSection icon={<PawPrint className="size-3" />} title={t('hooks')}>
          <AiCapabilityHint label={t('aiHintLabel')} body={t('aiHintHooks')} />
        </BriefSection>
      )}

      {/* Last concerns — clinical recap */}
      {brief.concerns.length > 0 ? (
        <BriefSection
          icon={<Clock className="size-3" />}
          title={t('concerns')}
          divider
        >
          <ul className="space-y-1">
            {brief.concerns.map((c, i) => (
              <li
                key={i}
                className="flex gap-2 text-[13px] leading-relaxed text-foreground/85"
              >
                <span className="mt-1 shrink-0 text-muted-foreground/60">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </BriefSection>
      ) : (
        <BriefSection
          icon={<Clock className="size-3" />}
          title={t('concerns')}
          divider
        >
          <AiCapabilityHint label={t('aiHintLabel')} body={t('aiHintConcerns')} />
        </BriefSection>
      )}

      {/* Last product + reaction */}
      {brief.lastProduct ? (
        <BriefSection
          icon={<Gift className="size-3" />}
          title={t('lastProduct')}
          divider
        >
          <div className="text-[13px] leading-relaxed text-foreground/90">
            <span className="font-medium">{brief.lastProduct.name}</span>
            {brief.lastProduct.reaction && (
              <span className="text-muted-foreground"> — {brief.lastProduct.reaction}</span>
            )}
          </div>
        </BriefSection>
      ) : (
        <BriefSection
          icon={<Gift className="size-3" />}
          title={t('lastProduct')}
          divider
        >
          <AiCapabilityHint label={t('aiHintLabel')} body={t('aiHintLastProduct')} />
        </BriefSection>
      )}

      {/* AI-suggested focus for this session */}
      {brief.recommendedFocus ? (
        <BriefSection
          icon={<Target className="size-3" />}
          title={t('recommendedFocus')}
          divider
        >
          <p className="text-[13px] leading-relaxed text-foreground/85">
            {brief.recommendedFocus}
          </p>
        </BriefSection>
      ) : (
        <BriefSection
          icon={<Target className="size-3" />}
          title={t('recommendedFocus')}
          divider
        >
          <AiCapabilityHint label={t('aiHintLabel')} body={t('aiHintRecommendedFocus')} />
        </BriefSection>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// File-local subcomponents
// ─────────────────────────────────────────────────────────────

function BriefSection({
  icon,
  title,
  children,
  divider,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  divider?: boolean
}) {
  return (
    <div className={divider ? 'mb-4 border-t border-blue-100/80 pt-3 dark:border-blue-500/15 last:mb-0' : 'mb-4 last:mb-0'}>
      <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

// Reservation-memo block — customer's own words from the booking form.
// Rendered verbatim (not AI-rewritten) so staff sees EXACTLY what the
// customer chose to say. Amber tint distinguishes it from AI-synthesized
// sections.
function MemoBlock({
  memo,
  label,
  className,
}: {
  memo: string
  label: string
  className?: string
}) {
  return (
    <div
      className={`rounded-lg bg-amber-50/70 p-3 ring-1 ring-amber-200/70 dark:bg-amber-500/[0.08] dark:ring-amber-500/20 ${className ?? ''}`}
    >
      <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-amber-800 dark:text-amber-300">
        <Quote className="size-3" aria-hidden />
        {label}
      </div>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
        {memo}
      </p>
    </div>
  )
}

// AI-capability scaffolding hint — surfaces what the (not-yet-wired) AI
// function will produce for a given section. Lets staff + Anthony see
// the contract before the nightly batch job exists. Visual language
// matches the karute project's existing "対応予定" pill convention
// (CustomerMemoryCard).
//
// ANTHONY: remove this component (and its callers) once the
// pre_session_briefs table is populated by the AI batch job — at that
// point real content fills the sections and the scaffolding hint is
// no longer informative.
function AiCapabilityHint({
  label,
  body,
  className,
}: {
  label: string
  body: string
  className?: string
}) {
  return (
    <div
      className={`flex gap-2 rounded-lg border border-dashed border-blue-300/60 bg-blue-50/40 p-2.5 dark:border-blue-500/30 dark:bg-blue-500/[0.06] ${className ?? ''}`}
    >
      <Wand2 className="mt-0.5 size-3 shrink-0 text-blue-500/80 dark:text-blue-300/80" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-1.5">
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            {label}
          </span>
        </div>
        <p className="text-[11px] italic leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  )
}
