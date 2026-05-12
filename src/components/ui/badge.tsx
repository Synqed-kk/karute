import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'
import { Icon, type IconName } from './icon'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sq-pill font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        accent: 'bg-sq-accent-soft text-sq-accent-text',
        success: 'bg-sq-success-soft text-sq-success-text',
        warning: 'bg-sq-warning-soft text-sq-warning-text',
        danger: 'bg-sq-danger-soft text-sq-danger-text',
        info: 'bg-sq-info-soft text-sq-info-text',
        violet: 'bg-sq-violet-soft text-sq-violet-text',
        teal: 'bg-sq-teal-soft text-sq-teal-text',
        rose: 'bg-sq-rose-soft text-sq-rose-text',
        neutral: 'bg-sq-bg-3 text-sq-text-2',
      },
      size: {
        xs: 'px-2 py-0.5 text-[10px]',
        sm: 'px-2.5 py-1 text-xs',
        md: 'px-3 py-1.5 text-sm',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      size: 'sm',
    },
  },
)

const ICON_SIZE = { xs: 10, sm: 12, md: 14 } as const

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  icon?: IconName
}

export function Badge({ className, tone, size, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {icon ? <Icon name={icon} size={ICON_SIZE[size ?? 'sm']} /> : null}
      {children}
    </span>
  )
}
