import * as React from 'react'

import { cn } from '@/lib/utils'

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  count?: number
  leading?: React.ReactNode
}

export function Chip({ active, count, leading, className, children, ...props }: ChipProps) {
  return (
    <button
      type="button"
      data-active={active ? 'true' : undefined}
      className={cn(
        'inline-flex items-center gap-2 rounded-sq-pill border px-4 py-2 text-[13px] font-medium transition-colors',
        active
          ? 'border-sq-accent-ring bg-sq-accent-soft text-sq-accent-text'
          : 'border-sq-stroke-1 bg-sq-bg-2 text-sq-text-2 hover:border-sq-stroke-2 hover:text-sq-text-1',
        className,
      )}
      {...props}
    >
      {leading}
      <span>{children}</span>
      {typeof count === 'number' ? (
        <span
          className={cn(
            'ml-0.5 rounded-sq-pill px-1.5 py-0.5 text-[11px]',
            active ? 'bg-sq-accent-ring text-sq-accent-text' : 'bg-sq-bg-3 text-sq-text-3',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}
