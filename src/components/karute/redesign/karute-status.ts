import type { KaruteDisplayStatus } from '@/lib/adapters/karute-list'

export interface KaruteStatusStyle {
  bg: string
  border: string
  text: string
  /** lucide-react icon name */
  icon: 'sparkles' | 'clock' | 'alert-triangle' | 'circle-dashed'
}

export const KARUTE_STATUS_STYLES: Record<KaruteDisplayStatus, KaruteStatusStyle> = {
  summarized: {
    bg: 'rgba(34, 197, 94, 0.14)',
    border: 'rgba(34, 197, 94, 0.32)',
    text: 'var(--color-completed-text, #15803d)',
    icon: 'sparkles',
  },
  pending: {
    bg: 'rgba(59, 130, 246, 0.14)',
    border: 'rgba(59, 130, 246, 0.32)',
    text: 'var(--color-in-session-text, #1d4ed8)',
    icon: 'clock',
  },
  review: {
    bg: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(245, 158, 11, 0.32)',
    text: 'var(--color-booked-text, #b45309)',
    icon: 'alert-triangle',
  },
  draft: {
    bg: 'rgba(148, 163, 184, 0.14)',
    border: 'rgba(148, 163, 184, 0.32)',
    text: 'var(--color-fg-muted, #64748b)',
    icon: 'circle-dashed',
  },
}
