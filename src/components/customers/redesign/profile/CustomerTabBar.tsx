'use client'

import { Brain, Clipboard, Image as ImageIcon, ShieldAlert } from 'lucide-react'

export type CustomerProfileTab = 'memory' | 'sessions' | 'photos' | 'privacy'

interface CustomerTabBarProps {
  active: CustomerProfileTab
  onChange: (tab: CustomerProfileTab) => void
  counts: { memory: number; sessions: number; photos: number }
}

const TABS: Array<{
  id: CustomerProfileTab
  label: string
  icon: typeof Brain
}> = [
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'sessions', label: 'Sessions', icon: Clipboard },
  { id: 'photos', label: 'Photos', icon: ImageIcon },
  { id: 'privacy', label: 'Privacy', icon: ShieldAlert },
]

export function CustomerTabBar({ active, onChange, counts }: CustomerTabBarProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
      {TABS.map((tab) => {
        const Icon = tab.icon
        const isActive = tab.id === active
        const count =
          tab.id === 'memory'
            ? counts.memory
            : tab.id === 'sessions'
              ? counts.sessions
              : tab.id === 'photos'
                ? counts.photos
                : undefined
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors ${
              isActive
                ? 'bg-sky-500/15 text-sky-200'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Icon size={14} />
            <span>{tab.label}</span>
            {count !== undefined && (
              <span
                className={`tabular-nums ${
                  isActive ? 'text-sky-300' : 'text-muted-foreground/70'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
