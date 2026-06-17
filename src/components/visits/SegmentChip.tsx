'use client'

// The visit-frequency SEGMENT as a colored pill (常連 / 安定 / 離脱気味 / 新規).
// Universal across surfaces. Returns null when there's no segment — a terminal
// lifecycle customer (卒業/離客) or missing data — so the caller keeps showing
// its own status chip instead. `visits` appends a compact ・N count for the
// dense surfaces (karute row, booking) where the panel doesn't fit.

import { useTranslations } from 'next-intl'
import type { VisitSegment } from '@/lib/visits/segment'
import { CHIP_CLASS, segmentToneRole } from './tone'

interface SegmentChipProps {
  segment: VisitSegment | null
  /** Append ・{visits} inside the chip (compact surfaces). */
  visits?: number | null
  size?: 'sm' | 'md'
}

export function SegmentChip({ segment, visits = null, size = 'md' }: SegmentChipProps) {
  const t = useTranslations('visits.segment')
  if (!segment) return null
  const pad = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-[11px]'
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border font-medium ${pad} ${CHIP_CLASS[segmentToneRole(segment)]}`}
    >
      {t(segment)}
      {visits != null && visits > 0 && (
        <span className="tabular-nums opacity-70">・{visits}</span>
      )}
    </span>
  )
}
