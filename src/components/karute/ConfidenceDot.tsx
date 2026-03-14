import { cn } from '@/lib/utils'

interface ConfidenceDotProps {
  score: number | null
  isManual: boolean
}

/**
 * Color-coded confidence indicator dot.
 * - Green  (>= 0.85): high confidence
 * - Amber  (>= 0.70): medium confidence
 * - Red    (<  0.70): low confidence
 * Manual entries and null scores render nothing.
 */
export function ConfidenceDot({ score, isManual }: ConfidenceDotProps) {
  if (isManual || score === null) return null

  const color =
    score >= 0.85
      ? 'bg-green-400'
      : score >= 0.7
        ? 'bg-amber-400'
        : 'bg-red-400'

  const percentage = Math.round(score * 100)

  return (
    <span
      className={cn('inline-block h-2 w-2 flex-shrink-0 rounded-full', color)}
      title={`${percentage}% confidence`}
      aria-label={`${percentage}% confidence`}
    />
  )
}
