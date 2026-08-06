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

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Gift,
  MessageCircle,
  PawPrint,
  Quote,
  Sparkles,
  Target,
  Wand2,
} from 'lucide-react'
import { parseQrMemo, QR_MEMO_LABELS } from '@/lib/sync/qr-notes'

// Approximate width at which the free-text 備考(参考) value overflows the 2-line
// clamp (~40 chars/line at this size). Below it, the value fits and the
// すべて表示 toggle is suppressed so staff never see a control that does nothing.
const NOTES_CLAMP_MIN_CHARS = 80

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
  /** AI's read of the booking memo — signals/concerns (兆候), expectations
   *  (期待), tone (トーン), points to watch (注意点). Rendered under the verbatim
   *  memo. Empty/undefined when there's no memo or no AI analysis. */
  memoAnalysis?: string[]
  // ── 30-second layer (2026-07-03 redesign) — all optional so the mechanical
  // fallback + pre-v7 cached briefs render the classic layout unchanged. ──
  /** ONE spoken first line to open with (from durable personal memory).
   *  Null/absent = no genuine material; the AI never forces one. */
  opener?: string | null
  /** The customer's own quoted words (『』/「」) from the latest session, verbatim. */
  lastWords?: string | null
  /** Must-know-before-touching cautions (history, metal, meds, pressure). */
  cautions?: string[]
  /** Up to 3 imperative actions for today; first = homework/promise re-entry. */
  todayActions?: string[]
  /** Pure date math — days since last visit + the usual gap (median). */
  rhythm?: { daysSince: number; usualGapDays: number | null } | null
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
  const [detailOpen, setDetailOpen] = useState(false)

  // No recording target (no booking selected — e.g. a day with zero
  // bookings). One quiet explainer line. The earlier empty-state
  // scaffold rendered every section as a 対応予定 placeholder, which
  // read as a broken page on closed days.
  if (!brief) {
    return (
      <section className="rounded-2xl bg-gradient-to-br from-blue-50/60 via-card to-card p-4 ring-1 ring-blue-100 dark:from-blue-500/10 dark:via-card dark:to-card dark:ring-blue-500/20 md:p-5">
        <header className="mb-2 flex items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
            <Sparkles className="size-3.5" aria-hidden />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('title')}
          </span>
        </header>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {t('noTarget')}
        </p>
      </section>
    )
  }

  const hasMemoAnalysis = (brief.memoAnalysis?.length ?? 0) > 0
  // 30-second layer (v7 AI briefs). When ANY of it exists the card leads with
  // opener → cautions → today's actions and folds the classic recap sections
  // into a 詳しい経過 toggle. Pre-v7 caches / the mechanical fallback have none
  // of these fields → classic layout renders exactly as before.
  const hasOpener = !!(brief.opener || brief.lastWords)
  const cautions = brief.cautions ?? []
  const todayActions = brief.todayActions ?? []
  const hasThirtySecondLayer = hasOpener || cautions.length > 0 || todayActions.length > 0
  // Layer-contract seat belt: the prompt forbids a hook from repeating the
  // opener's topic, but a slipped generation (or a stale cache) must still
  // never show the same line twice — drop a hook whose title is inside the
  // opener, or whose body is the opener restated. Length floors keep short
  // strings from matching incidentally (Japanese has no word boundaries:
  // 海 is inside 北海道, 運動 inside 運動会).
  // Degenerate-pair seat belt: a memo-only generation can emit a body that is
  // just the title rephrased (「同棲中の彼氏 — 彼氏と同棲中」). Substring checks
  // miss the word-order flip, so use character overlap: near-identical short
  // pairs score high (同棲中の彼氏/彼氏と同棲中 ≈ 0.71), while a real memory
  // detail dilutes far below the line — those bodies always survive. When it
  // trips we keep the hook and drop only the echo body.
  const dedupedHooks = brief.hooks.map((h) => {
    const title = normalizeForDedup(h.title)
    const body = normalizeForDedup(h.body ?? '')
    if (title.length >= 4 && body.length >= 4 && charOverlap(title, body) >= 0.6) {
      return { ...h, body: null }
    }
    return h
  })
  const openerNorm = normalizeForDedup(brief.opener ?? '')
  const visibleHooks = openerNorm
    ? dedupedHooks.filter((h) => {
        const title = normalizeForDedup(h.title)
        if (
          title.length >= 3 &&
          (openerNorm.includes(title) || (openerNorm.length >= 5 && title.includes(openerNorm)))
        )
          return false
        const body = normalizeForDedup(h.body ?? '')
        if (body.length >= 5 && openerNorm.length >= 5 && (openerNorm.includes(body) || body.includes(openerNorm)))
          return false
        return true
      })
    : dedupedHooks
  const rhythm = brief.rhythm ?? null
  const rhythmLabel = rhythm
    ? rhythm.usualGapDays && rhythm.usualGapDays > 0
      ? rhythm.daysSince <= rhythm.usualGapDays * 0.6
        ? t('rhythmEarly', { days: rhythm.daysSince })
        : rhythm.daysSince >= rhythm.usualGapDays * 1.7
          ? t('rhythmLate', { days: rhythm.daysSince })
          : null
      : null
    : null

  // FIRST-VISIT FRAMING — gradient blue card with warm intro copy.
  // Matches the spike's first-visit branch (no recap sections; just
  // an explainer + optional reservation memo). Only enters this
  // branch when we have a real brief flagged as first-time visit.
  if (brief.isFirstTimeVisit) {
    return (
      <section className="rounded-2xl bg-gradient-to-br from-blue-50/60 via-card to-card p-4 ring-1 ring-blue-100 dark:from-blue-500/10 dark:via-card dark:to-card dark:ring-blue-500/20 md:p-5">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
            <Sparkles className="size-3.5" aria-hidden />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('firstTimeHeader')}
          </span>
        </div>
        <p className="text-[14px] leading-relaxed text-foreground/90">
          {t('firstTimeBody', { name: customerName ?? '' })}
        </p>
        {/* Booking note verbatim when present. No memo → render nothing —
         *  the first-visit framing copy already carries the card, and an
         *  empty "AI will analyze the memo" hint read as broken/dead. */}
        {brief.reservationMemo && (
          <MemoBlock
            memo={brief.reservationMemo}
            label={t('reservationMemo')}
            className="mt-4"
          />
        )}
        {hasMemoAnalysis && (
          <MemoAnalysisBlock
            points={brief.memoAnalysis!}
            label={t('memoAnalysisLabel')}
            className="mt-2"
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
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
          <Sparkles className="size-3.5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
        {/* Rhythm badge — pure date math; only shown when today's gap clearly
         *  deviates from the customer's usual cadence (an early return or a
         *  long absence is signal BEFORE the customer says a word). */}
        {rhythmLabel && (
          <span className="shrink-0 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300">
            {rhythmLabel}
          </span>
        )}
      </header>

      {/* Reservation memo — surface FIRST when present (it's literal
       *  customer text for THIS visit, not AI-synthesized history).
       *  Most relevant hook staff should open with. */}
      {brief.reservationMemo ? (
        <>
          <MemoBlock
            memo={brief.reservationMemo}
            label={t('reservationMemo')}
            className={hasMemoAnalysis ? 'mb-2' : 'mb-4'}
          />
          {hasMemoAnalysis && (
            <MemoAnalysisBlock
              points={brief.memoAnalysis!}
              label={t('memoAnalysisLabel')}
              className="mb-4"
            />
          )}
        </>
      ) : null}

      {/* ① 会話の第一声 — the opener + the customer's own words from last
       *  time. THE first thing staff read: how to start the conversation. */}
      {hasOpener && (
        <div className="mb-3 rounded-lg border border-blue-200/70 bg-card/70 p-3 dark:border-blue-500/20">
          <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <MessageCircle className="size-3" aria-hidden />
            {t('opener')}
          </div>
          {brief.opener && (
            <p className="text-[14px] font-medium leading-relaxed text-foreground/95">
              {brief.opener}
            </p>
          )}
          {brief.lastWords && (
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {t('lastWords')}：{brief.lastWords}
            </p>
          )}
        </div>
      )}

      {/* ② 注意 — must-know-before-touching. Amber, always visible when the
       *  records carry safety/service cautions. */}
      {cautions.length > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50/80 p-3 ring-1 ring-amber-300/60 dark:bg-amber-500/[0.1] dark:ring-amber-500/30">
          <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-3" aria-hidden />
            {t('cautions')}
          </div>
          <ul className="space-y-1">
            {cautions.map((c, i) => (
              <li
                key={i}
                className="flex gap-2 text-[13px] leading-relaxed text-amber-900 dark:text-amber-100/90"
              >
                <span className="mt-0.5 shrink-0">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ③ 今日やること — 2-3 numbered actions; the skim replaces the prose. */}
      {todayActions.length > 0 && (
        <div className="mb-3 rounded-lg border border-blue-100/80 bg-card/70 p-3 dark:border-blue-500/15">
          <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <Target className="size-3" aria-hidden />
            {t('today')}
          </div>
          <ol className="space-y-1">
            {todayActions.map((a, i) => (
              <li
                key={i}
                className="flex gap-2 text-[14px] leading-relaxed text-foreground/90"
              >
                <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
                  {i + 1}.
                </span>
                <span>{a}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Detail toggle — the classic recap sections (hooks/concerns/product/
       *  focus) fold away when the 30-second layer is present. Without it
       *  (mechanical fallback, pre-v7 caches) they render as before. */}
      {hasThirtySecondLayer && (
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          className="mb-2 flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${detailOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
          {detailOpen ? t('detailHide') : t('detailShow')}
        </button>
      )}

      {(!hasThirtySecondLayer || detailOpen) && (() => {
        // The four detail sections. With the 30-second layer the detail is
        // pure HISTORY & CONTEXT, so it leads with the clinical trajectory
        // (経過 → 理由 → 前回の提案 → その他の話題). Without it (mechanical
        // fallback, pre-v8 caches) the classic hooks-first order renders
        // exactly as before. The top rule between sections comes from
        // BriefSection's own first:-variant styling, so whichever section
        // happens to render first (in either order) stays ruleless.
        const hooksSection =
          visibleHooks.length > 0 ? (
            <BriefSection
              icon={<PawPrint className="size-3" />}
              title={t('hooks')}
            >
              <ul className="space-y-1">
                {visibleHooks.map((h, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-[14px] leading-relaxed text-foreground/90"
                  >
                    <span className="mt-0.5 shrink-0 text-muted-foreground">•</span>
                    <span>
                      <span className="font-medium">{h.title}</span>
                      {h.body && <span className="text-muted-foreground"> — {h.body}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </BriefSection>
          ) : null

        const concernsSection =
          brief.concerns.length > 0 ? (
            <BriefSection
              icon={<Clock className="size-3" />}
              title={t('concerns')}
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
          ) : null

        const productSection =
          brief.lastProduct ? (
            <BriefSection
              icon={<Gift className="size-3" />}
              title={t('lastProduct')}
            >
              <div className="text-[13px] leading-relaxed text-foreground/90">
                <span className="font-medium">{brief.lastProduct.name}</span>
                {brief.lastProduct.reaction && (
                  <span className="text-muted-foreground"> — {brief.lastProduct.reaction}</span>
                )}
              </div>
            </BriefSection>
          ) : null

        const focusSection =
          brief.recommendedFocus ? (
            <BriefSection
              icon={<Target className="size-3" />}
              title={t('recommendedFocus')}
            >
              <p className="text-[13px] leading-relaxed text-foreground/85">
                {brief.recommendedFocus}
              </p>
            </BriefSection>
          ) : null

        return hasThirtySecondLayer ? (
          <div>
            {concernsSection}
            {focusSection}
            {productSection}
            {hooksSection}
          </div>
        ) : (
          <div>
            {hooksSection}
            {concernsSection}
            {productSection}
            {focusSection}
          </div>
        )
      })()}
    </section>
  )
}

// Strip whitespace + punctuation so "restated with different punctuation"
// still registers as a duplicate (筋トレ再開したそうですね。 vs 筋トレ再開).
function normalizeForDedup(s: string): string {
  return s.replace(/[\s　、。・．，,.!！?？「」『』()（）〜~ー–—:：]/g, '')
}

/** Character-set Jaccard overlap — order-insensitive similarity for short
 *  Japanese strings (no word boundaries). 1.0 = same characters; a body that
 *  genuinely adds detail dilutes the union and scores low. */
function charOverlap(a: string, b: string): number {
  const ca = new Set(a)
  const cb = new Set(b)
  let shared = 0
  for (const ch of ca) if (cb.has(ch)) shared++
  const union = new Set([...ca, ...cb]).size
  return union === 0 ? 0 : shared / union
}

// ─────────────────────────────────────────────────────────────
// File-local subcomponents
// ─────────────────────────────────────────────────────────────

function BriefSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-4 border-t border-blue-100/80 pt-3 first:border-t-0 first:pt-0 dark:border-blue-500/15 last:mb-0">
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
//
// When the memo carries QuickReserve's ▶key:value structure it's rendered as
// skimmable labeled rows (same parse as the カルテ customer tab, via parseQrMemo)
// so staff can scan 症状 / ゴール / セルフ / 回数 at a glance before the session.
// Two briefing-only differences from the customer tab: empty-value keys are
// OMITTED (a bare "quick:" would just be noise here), and the long free-text
// 備考(参考) row collapses to a 2-line clamp with a すべて表示 / 閉じる toggle.
// A memo with no ▶ structure falls back to the verbatim single-paragraph render.
function MemoBlock({
  memo,
  label,
  className,
}: {
  memo: string
  label: string
  className?: string
}) {
  const t = useTranslations('recording.brief')
  const [memoExpanded, setMemoExpanded] = useState(false)
  // Drop empty-value segments (e.g. "▶quick:" with nothing after it) — in the
  // customer tab those render as "—", but in the pre-session skim they're noise.
  const rows = parseQrMemo(memo)?.filter((r) => r.value) ?? null
  // The free-text 備考(参考) row is the one long value staff shouldn't have to
  // scroll past; clamp it to 2 lines behind a toggle. Everything else is short.
  const notesLabel = QR_MEMO_LABELS['参考']

  return (
    <div
      className={`rounded-lg bg-amber-50/70 p-3 ring-1 ring-amber-200/70 dark:bg-amber-500/[0.08] dark:ring-amber-500/20 ${className ?? ''}`}
    >
      <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-amber-800 dark:text-amber-300">
        <Quote className="size-3" aria-hidden />
        {label}
      </div>
      {rows && rows.length > 0 ? (
        <dl className="space-y-1.5">
          {rows.map((r, i) => {
            // Only the 備考(参考) row clamps, and only when it's actually long
            // enough for a 2-line clamp to bite — CSS line-clamp can't report
            // overflow to React, so approximate with length/newlines. A one-line
            // 備考 renders plain, without a toggle that would do nothing.
            const clampable =
              r.label === notesLabel &&
              (r.value.length >= NOTES_CLAMP_MIN_CHARS || r.value.includes('\n'))
            return (
              <div
                key={i}
                className="grid grid-cols-[4.5rem_1fr] gap-2.5 text-[13px] leading-relaxed"
              >
                <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-amber-800/80 dark:text-amber-300/80">
                  {r.label || '—'}
                </dt>
                <dd className="min-w-0 text-foreground/90">
                  <p
                    className={`whitespace-pre-wrap ${
                      clampable && !memoExpanded ? 'line-clamp-2' : ''
                    }`}
                  >
                    {r.value}
                  </p>
                  {clampable && (
                    <button
                      type="button"
                      aria-expanded={memoExpanded}
                      onClick={() => setMemoExpanded((v) => !v)}
                      className="mt-0.5 text-[11px] font-medium text-amber-700 transition-colors hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200"
                    >
                      {memoExpanded ? t('memoCollapse') : t('memoShowAll')}
                    </button>
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      ) : (
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
          {memo}
        </p>
      )}
    </div>
  )
}

// AI's read of the booking memo — the analysis the reservation-memo box always
// promised ("AIがご予約メモを解析し…"). Distinct from MemoBlock (the customer's
// verbatim words): this is the AI's extracted 兆候 / 期待 / トーン / 注意点.
function MemoAnalysisBlock({
  points,
  label,
  className,
}: {
  points: string[]
  label: string
  className?: string
}) {
  return (
    <div
      className={`flex gap-2 rounded-lg border border-blue-200/70 bg-blue-50/50 p-3 dark:border-blue-500/20 dark:bg-blue-500/[0.07] ${className ?? ''}`}
    >
      <Wand2 className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <ul className="space-y-0.5">
          {points.map((p, i) => (
            <li
              key={i}
              className="flex gap-1.5 text-[12px] leading-relaxed text-foreground/85"
            >
              <span className="mt-0.5 shrink-0 text-muted-foreground">•</span>
              {/* The model occasionally emits a stray leading colon (":猫背改善中→…").
               *  Strip it at render — a lone bullet+colon reads as broken. */}
              <span>{p.replace(/^[:：]\s*/, '')}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

