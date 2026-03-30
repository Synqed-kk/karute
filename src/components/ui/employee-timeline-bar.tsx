'use client'

export type EmployeeTimelineBarType = 'booking' | 'open' | 'completed' | 'blocked' | 'recording' | 'processing'

export interface EmployeeTimelineBarData {
  id: string
  rowId: string
  startMinute: number
  durationMinute: number
  title: string
  subtitle?: string
  type: EmployeeTimelineBarType
}

export interface EmployeeTimelineBarProps {
  item: EmployeeTimelineBarData
  className?: string
}

const FALLBACK_COLORS: Record<string, string> = {
  open: '#5ba8b5',
  booking: '#c4897a',
  recording: '#e6a84d',
  completed: '#6bab8a',
  blocked: '#c4a0a6',
  processing: '#8b5cf6',
}

const ANIMATE_TYPES = new Set(['recording', 'processing'])

export function EmployeeTimelineBar({ item, className = '' }: EmployeeTimelineBarProps) {
  const cssVar = `var(--bar-${item.type}, ${FALLBACK_COLORS[item.type] ?? FALLBACK_COLORS.open})`
  const animate = ANIMATE_TYPES.has(item.type) ? 'animate-pulse' : ''
  const textColor = item.type === 'blocked' ? '#f8f1f1' : 'white'

  return (
    <div
      className={`h-full w-full rounded-[24px] px-4 py-2 text-[11px] font-semibold leading-[1.3] ${animate} ${className}`}
      style={{ backgroundColor: cssVar, color: textColor }}
    >
      <div>{item.title}</div>
      {item.subtitle ? <div className="whitespace-pre-line">{item.subtitle}</div> : null}
    </div>
  )
}
