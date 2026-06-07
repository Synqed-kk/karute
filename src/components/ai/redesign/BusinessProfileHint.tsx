'use client'

import { Settings, Target } from 'lucide-react'
import { useRouter } from '@/i18n/navigation'
import type { BusinessProfile } from '@/lib/welcome/business-types'

interface BusinessProfileHintProps {
  profile: BusinessProfile | null
}

export function BusinessProfileHint({ profile }: BusinessProfileHintProps) {
  const router = useRouter()
  if (!profile) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-card/40 p-3 text-xs text-muted-foreground">
        <Target size={13} className="mt-0.5 shrink-0 text-muted-foreground/70" />
        <div className="flex-1">
          <div className="text-foreground">No business type set</div>
          <p className="mt-0.5">
            Set your business type in Settings to tune the AI to your salon&apos;s
            vocabulary and surface industry-specific prompts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/welcome')}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Settings size={11} />
          <span>Set up</span>
        </button>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
      <Target size={13} className="mt-0.5 shrink-0 text-sky-400" />
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Tuned for</span>
          <span className="font-semibold text-foreground">{profile.label}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">{profile.tagline}</p>
      </div>
      <button
        type="button"
        onClick={() => router.push('/settings')}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Change business type in Settings"
      >
        <Settings size={11} />
        <span>Change</span>
      </button>
    </div>
  )
}
