'use client'

// The ticket-aware CLOSING-TACTIC strip — segment × 回数券有無 → one compliance-
// locked JA imperative. The tactic COPY lives in next-intl (visits.tactic.*),
// keyed by the helper's stable TacticKey, so the set exists in exactly one place
// and a callsite can only pick a key, never invent a line. Returns null when
// there's no segment (terminal lifecycle / missing data).
//
// Copy is booking/ticket-FACT framed only — no 薬機法 efficacy or 景表法
// exaggeration. It never states a 回数券 remaining COUNT (the detail table that
// would back an exact number is empty today); it speaks to holding a pack, not
// "N left".

import { useTranslations } from 'next-intl'
import { Target } from 'lucide-react'
import { type VisitSegment, visitTacticKey } from '@/lib/visits/segment'
import { STRIP_CLASS, STRIP_ICON_CLASS, segmentToneRole } from './tone'

interface ClosingTacticHintProps {
  segment: VisitSegment | null
  hasTicketPack: boolean
}

export function ClosingTacticHint({ segment, hasTicketPack }: ClosingTacticHintProps) {
  const t = useTranslations('visits.tactic')
  if (!segment) return null
  const tone = segmentToneRole(segment)
  return (
    <div className={`flex items-start gap-2 rounded-lg p-2.5 ${STRIP_CLASS[tone]}`}>
      <Target size={16} className={`mt-0.5 shrink-0 ${STRIP_ICON_CLASS[tone]}`} aria-hidden />
      <p className="text-[12.5px] leading-relaxed">{t(visitTacticKey(segment, hasTicketPack))}</p>
    </div>
  )
}
