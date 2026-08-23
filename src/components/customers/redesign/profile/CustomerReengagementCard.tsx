'use client'

// ============================================================
// CustomerReengagementCard — AI-drafted re-engagement message
// ============================================================
// Spike-lift of design-spike src/components/customers/CustomerReengagementCard.tsx
// (§13, AI_PROMPTS.md). Structure preserved: header + tier chip + days-ago
// chip + draft preview + why-disclosure with signals + one action button.
// Visual chrome matches this page's real cards (TicketPackCard/
// BookingMemoCard: rounded-2xl border border-border bg-card) rather than
// the spike's raw gradient classes — same "spike-lift" convention as
// CustomerProfileView.tsx's own header comment (structure, not literal CSS).
//
// Gate + generation live server-side (ai-reengagement.ts); this component
// only renders an already-produced draft. Copy-paste-only send via the
// existing MessageComposeDialog — same flow as the karute-detail sibling
// AISuggestedMessageCard (see that file's dialog header comment for the
// LINE-linkage design note).

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Sparkles, Send, ChevronDown, ChevronUp, Clock, Brain, Calendar, TrendingUp } from 'lucide-react'
import { MessageComposeDialog } from '@/components/messaging/MessageComposeDialog'
import type { ReengagementDraft, ReengagementSignal } from '@/lib/karute/ai-reengagement'

interface CustomerReengagementCardProps {
  customerId: string
  customerName: string
  /** Nd-ago chip. Null hides the chip (no dated last visit on file). */
  lastVisitAgoDays: number | null
  draft: ReengagementDraft
}

// Local — matches AISuggestedMessageCard.tsx's own deriveInitials. This card
// only receives id+name (not the full CustomerProfileData), so it derives
// its MessageComposeDialog customer shape the same way that sibling card
// does rather than threading an extra `initials` prop through the slot.
function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '??'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function SignalIcon({ kind }: { kind: ReengagementSignal['kind'] }) {
  if (kind === 'memory_item') {
    return <Brain className="size-3 shrink-0 mt-0.5 text-purple-600 dark:text-purple-300" aria-hidden />
  }
  if (kind === 'session') {
    return <Calendar className="size-3 shrink-0 mt-0.5 text-blue-600 dark:text-blue-300" aria-hidden />
  }
  if (kind === 'prediction') {
    return <TrendingUp className="size-3 shrink-0 mt-0.5 text-sky-600 dark:text-sky-300" aria-hidden />
  }
  return <Clock className="size-3 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
}

const TIER_CHIP_CLASSES: Record<ReengagementDraft['tier'], string> = {
  dormant:
    'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 ring-red-200/70 dark:ring-red-500/20',
  overdue:
    'bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 ring-amber-200/70 dark:ring-amber-500/25',
}

export function CustomerReengagementCard({
  customerId,
  customerName,
  lastVisitAgoDays,
  draft,
}: CustomerReengagementCardProps) {
  const t = useTranslations('customers.profileUpcoming.reengagement')
  const [whyOpen, setWhyOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)

  const customer = { id: customerId, name: customerName, initials: deriveInitials(customerName) }

  return (
    <>
      <section
        className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5"
        aria-labelledby="reengagement-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
              <Sparkles className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 id="reengagement-heading" className="text-[14px] font-semibold text-foreground md:text-sm">
                {t('title')}
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t('subtitle')}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={`inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium ring-1 ${TIER_CHIP_CLASSES[draft.tier]}`}
            >
              <Clock className="size-2.5" aria-hidden />
              {t(`tier.${draft.tier}`)}
            </span>
            {lastVisitAgoDays !== null && (
              <span className="inline-flex h-5 items-center rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground ring-1 ring-border">
                {t('daysAgo', { n: lastVisitAgoDays })}
              </span>
            )}
          </div>
        </div>

        {/* Draft body preview */}
        <div className="mt-3 rounded-lg bg-muted/40 p-3.5 ring-1 ring-border/60">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">{draft.draft}</p>
        </div>

        {/* Why this message? — collapsed by default so the card reads as
         *  "the message" first; staff expands to sanity-check the AI's
         *  signal picks before sending. */}
        <button
          type="button"
          onClick={() => setWhyOpen((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={whyOpen}
          aria-controls="reengagement-reasoning"
        >
          {whyOpen ? <ChevronUp className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
          {t('whyToggle')}
        </button>

        {whyOpen && (
          <div
            id="reengagement-reasoning"
            className="mt-2 space-y-2 rounded-md bg-muted/30 px-3 py-2.5 ring-1 ring-border/60"
          >
            <p className="text-[11px] leading-relaxed text-foreground/80">{draft.reasoning}</p>
            {draft.signals.length > 0 && (
              <ul className="space-y-1 text-[11px] text-muted-foreground">
                {draft.signals.map((signal, i) => (
                  <li key={`${signal.kind}-${i}`} className="flex items-start gap-1.5">
                    <SignalIcon kind={signal.kind} />
                    <span className="min-w-0 flex-1 text-foreground/80">{signal.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Action row */}
        <div className="mt-4 flex items-center justify-end">
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Send className="size-3.5" aria-hidden />
            {t('sendButton')}
          </button>
        </div>
      </section>

      <MessageComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        customer={customer}
        initialBody={draft.draft}
        source="reengagement"
        aiDrafted
      />
    </>
  )
}
