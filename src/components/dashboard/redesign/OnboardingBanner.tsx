'use client'

import { ArrowRight, Sparkles, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function OnboardingBanner() {
  const router = useRouter()
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-sky-500/25 bg-gradient-to-br from-sky-500/10 to-sky-500/5 p-4 shadow-sm md:p-5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-300">
        <Sparkles size={16} />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="text-sm font-semibold text-foreground">
          Finish setting up your store
        </div>
        <p className="text-xs text-muted-foreground">
          Pick your business type + recording disclosure mode so the AI is tuned to your salon. Takes about 2 minutes.
        </p>
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push('/welcome')}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-sky-500 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-sky-600"
          >
            <span>Start setup</span>
            <ArrowRight size={13} />
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={12} />
            <span>Dismiss</span>
          </button>
        </div>
      </div>
    </div>
  )
}
