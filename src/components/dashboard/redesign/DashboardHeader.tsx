'use client'

import { Crown, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface DashboardHeaderProps {
  name: string
  isOwner: boolean
  dateFormatted: string
  onboardingComplete: boolean
}

function greetingForHour(h: number): string {
  if (h < 5) return 'Good night'
  if (h < 11) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardHeader({
  name,
  isOwner,
  dateFormatted,
  onboardingComplete,
}: DashboardHeaderProps) {
  const router = useRouter()
  const greeting = greetingForHour(new Date().getHours())

  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground md:text-[26px]">
          {greeting},{' '}
          <span className="text-foreground">{name}</span>
        </h1>
        <div className="mt-1.5 text-xs text-muted-foreground md:text-sm">
          {dateFormatted}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {isOwner && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 text-xs font-medium text-sky-200">
            <Crown size={13} className="text-sky-300" />
            Owner view
          </span>
        )}
        <button
          type="button"
          onClick={() => router.push('/welcome')}
          className={`relative inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-xs font-semibold transition-colors ${
            onboardingComplete
              ? 'border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
              : 'border border-emerald-500/40 bg-emerald-600 text-emerald-50 hover:bg-emerald-700'
          }`}
        >
          <Sparkles size={13} />
          <span>Setup store</span>
          {!onboardingComplete && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-300 ring-2 ring-background" />
          )}
        </button>
      </div>
    </header>
  )
}
