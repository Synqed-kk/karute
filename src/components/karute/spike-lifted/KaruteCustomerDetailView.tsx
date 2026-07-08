'use client'

// STRUCTURE: mirror of the spike's karute detail page
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/app/[locale]/(app)/karute/page.tsx
//
// This is the SECOND of two customer-detail surfaces in the app:
//
//   - /customers/[id]            → customer profile (tabs: Memory /
//                                   Sessions / Photos / Privacy)
//                                   Reached from the 顧客 tab.
//
//   - /karute/customer/[id]      → karute detail (vertical stack of
//                                   AI sections). Reached from the
//                                   カルテ tab. THIS PAGE.
//
// Section order (matches spike's KaruteDetailPage line-for-line):
//   1. Back-to-karute-list breadcrumb
//   2. CustomerIdentityCard          (= spike CustomerHeaderCard)
//   3. Customer memory section       (= spike CustomerMemoryCard;
//                                       stub for now via MemoryTabContent)
//   4. PhotoRecordCard               (= spike PhotoRecordCard, lifted)
//   5. AIBodyPredictionPreview       \  spike: lg:grid-cols-2 row
//      + AIOutreachPreview           /
//   6. Session entries (main col)    \ spike: lg:grid-cols-[1.4fr_1fr]
//      + AISummaryPreview            |    main = SessionsTabContent stub
//      + RecordingTranscriptPreview  /    sidebar = both AI placeholders
//   7. KaruteCoachingPanel placeholder  (Coming Soon stub — staff-only)
//
// All AI surfaces render as `対応予定` placeholders today. Each preview
// has an inline ANTHONY block in UpcomingAiFeatures.tsx pointing at
// the spike source + AI_INTEGRATION_SPEC.md section + expected data
// shape. When a real implementation lands, swap the `<…Preview>` at
// the matching position — section grid doesn't move.

import { ChevronLeft } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { CustomerProfileData } from '@/components/customers/redesign/types'
import { CustomerIdentityCard } from '@/components/customers/redesign/profile/CustomerIdentityCard'
import { CustomerMemoryCard } from './memory/CustomerMemoryCard'
import { BookingMemoCard } from '@/components/customers/redesign/profile/BookingMemoCard'
import {
  SessionsTabContent,
  type CustomerSessionEntry,
} from '@/components/customers/redesign/profile/SessionsTabContent'
import {
  AIBodyPredictionPreview,
  AISummaryPreview,
} from '@/components/customers/redesign/profile/UpcomingAiFeatures'
import { PhotoRecordCard } from './photos/PhotoRecordCard'
import { AIOutreachCard } from './outreach/AIOutreachCard'
import { SessionEntryTimeline } from './session/SessionEntryTimeline'
import { TranscriptCard } from './transcript/TranscriptCard'
import { KaruteAiAssistSheets } from './KaruteAiAssistSheets'

interface KaruteCustomerDetailViewProps {
  customer: CustomerProfileData
  sessions: CustomerSessionEntry[]
}

export function KaruteCustomerDetailView({
  customer,
  sessions,
}: KaruteCustomerDetailViewProps) {
  return (
    <main className="mx-auto w-full max-w-[1280px] pb-10">
      {/* 1. Back link — slim top bar. OWNS its own px-4 md:px-6 because
       *  this page intentionally has NO wrapper padding (matches spike's
       *  karute detail page, which uses pb-10-only so cards bleed to
       *  viewport edges on mobile). So each piece of chrome on this
       *  page provides its own horizontal padding. */}
      <div className="px-4 pt-3 md:px-6 md:pt-4">
        <Link
          href={'/karute' as Parameters<typeof Link>[0]['href']}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={14} />
          <span>カルテ一覧へ</span>
        </Link>
      </div>

      {/* 2. Identity — flat section, matches spike CustomerHeaderCard */}
      <CustomerIdentityCard c={customer} />

      {/* 2b. Booking/intake memo from QuickReserve (customer.notes) — the
       *  richest first-touch info, surfaced read-only until AI extraction
       *  fills the structured memory boxes below. Renders nothing when empty. */}
      <div className="md:px-6 md:pt-5">
        <BookingMemoCard customerId={customer.id} memo={customer.bookingMemo} />
      </div>

      {/* 3. Customer memory — lifted spike CustomerMemoryCard (visual
       *  port with inline sample data; mutations stubbed). */}
      <div className="md:px-6 md:pt-5">
        <CustomerMemoryCard
          customerName={customer.name}
          pastSessionCount={customer.sessionCount}
        />
      </div>

      {/* 4. Photo records — lifted from spike */}
      <div className="md:px-6 md:pt-5">
        <PhotoRecordCard customerName={customer.name} />
      </div>

      {/* 5. AI body prediction + AI outreach — 2-col on lg+. Outreach
       *  is the LIFTED card with editable preview + edit/send buttons
       *  (currently empty + buttons stubbed until Anthony wires the AI
       *  generator + channel send). Body prediction stays as the
       *  Coming-Soon placeholder until lifted. */}
      <div className="md:px-6 md:pt-5 md:pb-5 md:grid md:grid-cols-1 lg:grid-cols-2 md:gap-3">
        <AIBodyPredictionPreview />
        <AIOutreachCard customerName={customer.name} />
      </div>

      {/* 6. Session entries (main) + AI summary + transcript (sidebar).
       *  Spike layout: lg:grid-cols-[1.4fr_1fr]. */}
      <div className="md:px-6 md:pb-5">
        <div className="md:grid md:grid-cols-1 lg:grid-cols-[1.4fr_1fr] md:gap-5">
          {/* Main column — session entry timeline (lifted). Sessions
           *  data still piped through from karute_records via the
           *  existing SessionsTabContent shape; the timeline renders
           *  empty until per-utterance entry extraction is wired
           *  (separate from the session list — see
           *  AI_PROMPTS.md §4 in the spike). */}
          <div className="md:rounded-lg md:bg-card md:p-4 md:ring-1 md:ring-black/5 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:dark:ring-white/5 md:dark:shadow-none">
            <SessionEntryTimeline
              sessionDate={
                sessions[0]?.date ?? new Date().toISOString().slice(0, 10)
              }
              entries={[]}
            />
            {/* Existing session list (Anthony's) — kept inline below
             *  so the karute records that DO exist still surface,
             *  while the entry-timeline scaffold above shows the
             *  spike's per-utterance pattern for once AI extraction
             *  lands. */}
            {sessions.length > 0 && (
              <div className="mt-4 border-t border-border/40 pt-4">
                <SessionsTabContent sessions={sessions} />
              </div>
            )}
          </div>
          {/* Desktop sidebar — AI Summary + Transcript render inline as
           *  cards in the right column. Hidden on mobile because mobile
           *  uses the KaruteAiAssistSheets pattern below (list rows that
           *  open bottom sheets — matches the spike's MobileKaruteSheets). */}
          <div className="hidden space-y-4 md:block">
            <AISummaryPreview />
            <TranscriptCard hasRecording={false} />
          </div>
        </div>
      </div>

      {/* Mobile-only: AI Summary + Transcript as compact list-row
       *  triggers that open bottom sheets. Matches spike's
       *  MobileKaruteSheets pattern (the screenshots Liam shared). */}
      <KaruteAiAssistSheets
        sessionDate={sessions[0]?.date}
        hasRecording={false}
      />

      {/* 7. KaruteCoachingPanel — spike's staff-private coaching tips.
       *  Not lifted yet (Layer 1, requires role context that karute
       *  doesn't have). Placeholder banner so the section exists in
       *  the layout. ANTHONY: when role-context plumbing lands, lift
       *  the panel from src/components/coaching/KaruteCoachingPanel.tsx
       *  per AI_PROMPTS.md §12 (in-session coaching). */}
      <div className="md:px-6 md:pt-5">
        <div className="border-t border-black/5 px-4 py-4 dark:border-white/5 md:rounded-2xl md:border-t-0 md:border md:border-amber-200/60 md:dark:border-amber-500/20 md:px-5">
          <div className="flex items-start gap-2">
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
              対応予定
            </span>
            <div className="flex-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                コーチングパネル
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                セッション中の応対について、スタッフ向けにAIがリアルタイムでコーチング提案を提供します（スタッフ専用・オーナーには非表示）。
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
