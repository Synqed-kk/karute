import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const cardVariants = cva(
  'relative rounded-sq-lg border border-sq-stroke-1 bg-sq-bg-2 shadow-sq-1 transition-colors',
  {
    variants: {
      interactive: {
        true: 'cursor-pointer hover:bg-sq-bg-3 hover:border-sq-stroke-2',
        false: '',
      },
    },
    defaultVariants: {
      interactive: false,
    },
  },
)

const ACCENT_VAR: Record<NonNullable<CardProps['accent']>, string> = {
  accent: 'var(--sq-accent)',
  success: 'var(--sq-success)',
  warning: 'var(--sq-warning)',
  danger: 'var(--sq-danger)',
  info: 'var(--sq-info)',
  violet: 'var(--sq-violet)',
  teal: 'var(--sq-teal)',
  rose: 'var(--sq-rose)',
}

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  accent?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'teal' | 'rose'
}

export function Card({ className, interactive, accent, style, children, ...props }: CardProps) {
  const accentStyle = accent
    ? {
        ...style,
        boxShadow: `inset 3px 0 0 0 ${ACCENT_VAR[accent]}`,
      }
    : style
  return (
    <div className={cn(cardVariants({ interactive }), className)} style={accentStyle} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between px-6 pt-5 pb-3', className)} {...props} />
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pb-5', className)} {...props} />
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-end gap-2 border-t border-sq-stroke-1 px-6 py-3', className)} {...props} />
}
