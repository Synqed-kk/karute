'use client'

export type EmployeeTimelineBarType = 'booking' | 'open' | 'blocked' | 'recording' | 'processing'

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
    processing: 'animate-pulse border-[#8b5cf6] bg-[#8b5cf6]/80 text-white',
    recording: 'animate-pulse border-[#f59e0b] bg-[#f59e0b]/80 text-white',
    booking: 'border-[#4db4ca] bg-[#6db6c8] text-[#e8eff1]',
    blocked: 'border-[#d59fa5] bg-[#d4a1a6] text-[#f8f1f1]',
    open: 'border-[#4db4ca] bg-[#b9bfc3] text-[#d5dde0]',
  }
  const baseClass = typeStyles[item.type] || typeStyles.open

  return (
    <div className={`h-full w-full rounded-[24px] border px-4 py-2 text-[9px] font-semibold leading-[1.15] ${baseClass} ${className}`}>
      <div>{item.title}</div>
      {item.subtitle ? <div className="whitespace-pre-line">{item.subtitle}</div> : null}
    </div>
  )
}
