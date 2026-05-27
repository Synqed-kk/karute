'use client'

// Lifted from spike: components/coaching/PrivacyLockBadge.tsx
// (lines 10-22). Tiny indicator that surfaces inside Layer 1
// (staff-private) cards to communicate "only you see this".
//
// ANTHONY: no behavior changes when data lands — this is a pure
// presentational badge. Backend RLS is the actual enforcement.

import { Lock } from 'lucide-react'

import { cn } from '@/lib/utils'

interface PrivacyLockBadgeProps {
  label: string
  className?: string
}

export function PrivacyLockBadge({ label, className }: PrivacyLockBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300',
        className,
      )}
    >
      <Lock className="size-2.5" aria-hidden />
      {label}
    </span>
  )
}
