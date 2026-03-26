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

export function EmployeeTimelineBar({ item, className = '' }: EmployeeTimelineBarProps) {
  const typeStyles: Record<string, string> = {
    processing: 'animate-pulse bg-[#8b5cf6]/80 text-white',
    recording: 'animate-pulse bg-[#eab308]/90 text-white',
    booking: 'bg-[#3b82f6] text-white',
    completed: 'bg-[#22c55e] text-white',
    blocked: 'bg-[#d4a1a6] text-[#f8f1f1]',
    open: 'bg-[#3b82f6] text-white',
  }
  const baseClass = typeStyles[item.type] || typeStyles.open

  return (
    <div className={`h-full w-full rounded-[24px] px-4 py-2 text-[11px] font-semibold leading-[1.3] ${baseClass} ${className}`}>
      <div>{item.title}</div>
      {item.subtitle ? <div className="whitespace-pre-line">{item.subtitle}</div> : null}
    </div>
  )
}
