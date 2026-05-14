'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Heart,
  MessageCircle,
  Pin,
  Plus,
  Sparkles,
  Target,
  User,
} from 'lucide-react'

import { cn } from '@/lib/utils'

export type MemorySection =
  | 'personal'
  | 'body'
  | 'preferences'
  | 'goals'
  | 'lifestyle'

export interface MemoryItem {
  id: string
  section: MemorySection
  title: string
  body: string
  source: 'ai' | 'intake' | 'manual'
  date: string
  pinned?: boolean
}

export interface CustomerMemorySnapshot {
  customerName: string
  /** Pinned + recently-extracted items shown above the sections. */
  talkingPoints: { title: string; body: string }[]
  /** Number of items extracted today (drives the "X new from today" badge). */
  newToday: number
  /** Pretty date of the most recent update. */
  lastUpdated: string | null
  items: MemoryItem[]
}

interface CustomerMemoryCardProps {
  memory: CustomerMemorySnapshot | null
}

const SECTION_ICON = {
  personal: User,
  body: Heart,
  preferences: Sparkles,
  goals: Target,
  lifestyle: User,
} as const

const SECTION_TONE: Record<MemorySection, { bg: string; text: string }> = {
  personal: { bg: 'rgba(96, 165, 250, 0.18)', text: '#60a5fa' },
  body: { bg: 'rgba(244, 114, 182, 0.18)', text: '#f472b6' },
  preferences: { bg: 'rgba(192, 132, 252, 0.18)', text: '#c084fc' },
  goals: { bg: 'rgba(52, 211, 153, 0.18)', text: '#34d399' },
  lifestyle: { bg: 'rgba(251, 191, 36, 0.18)', text: '#fbbf24' },
}

const SECTION_ORDER: MemorySection[] = [
  'personal',
  'body',
  'preferences',
  'goals',
  'lifestyle',
]

export function CustomerMemoryCard({ memory }: CustomerMemoryCardProps) {
  const t = useTranslations('karuteDetail.memory')
  const [open, setOpen] = useState<Record<MemorySection, boolean>>({
    personal: true,
    body: false,
    preferences: false,
    goals: false,
    lifestyle: false,
  })

  if (!memory || memory.items.length === 0) return null

  const grouped = SECTION_ORDER.map((section) => ({
    section,
    items: memory.items.filter((i) => i.section === section),
  }))

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex flex-wrap items-start gap-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-500">
          <Brain size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-foreground">{t('title')}</div>
          <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
            {t('subtitle', { name: memory.customerName })}
          </div>
        </div>
        {memory.newToday > 0 && (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-sky-500/18 px-2.5 text-[11px] font-semibold text-sky-300">
            <Sparkles size={12} />
            <span>{t('newToday', { n: memory.newToday })}</span>
          </span>
        )}
      </header>

      {memory.talkingPoints.length > 0 && (
        <div className="mb-4 rounded-xl border border-sky-500/20 bg-sky-500/8 p-4">
          <div className="mb-2.5 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-sky-400">
            <MessageCircle size={12} />
            <span>{t('talkingPoints')}</span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {memory.talkingPoints.map((tp, i) => (
              <li
                key={i}
                className="grid grid-cols-[12px_1fr] items-baseline gap-1.5 text-sm leading-snug md:grid-cols-[12px_auto_auto_1fr] md:gap-1.5"
              >
                <span
                  className="mt-2 inline-block h-1.5 w-1.5 rounded-full bg-sky-400"
                  aria-hidden
                />
                <span className="font-semibold text-foreground md:whitespace-nowrap">
                  {tp.title}
                </span>
                <span aria-hidden className="hidden text-muted-foreground/50 md:inline">
                  —
                </span>
                <span className="text-foreground/80">{tp.body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col">
        {grouped.map(({ section, items }) => {
          const Icon = SECTION_ICON[section]
          const tone = SECTION_TONE[section]
          const isOpen = open[section]
          return (
            <div key={section} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() =>
                  setOpen((prev) => ({ ...prev, [section]: !prev[section] }))
                }
                className="flex w-full items-center gap-3 py-3.5 text-left"
              >
                <span
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  style={{ background: tone.bg, color: tone.text }}
                >
                  <Icon size={14} />
                </span>
                <span className="flex-1 text-sm font-semibold text-foreground">
                  {t(`sections.${section}`)}
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {items.length}
                </span>
                {isOpen ? (
                  <ChevronDown size={14} className="text-muted-foreground" />
                ) : (
                  <ChevronRight size={14} className="text-muted-foreground" />
                )}
              </button>
              {isOpen && items.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-3 pb-3.5 pl-10 pr-0">
                  {items.map((it) => (
                    <li
                      key={it.id}
                      className={cn(
                        'relative pl-3.5',
                        'before:absolute before:left-0 before:top-2 before:h-1 before:w-1 before:rounded-full before:bg-foreground/30',
                      )}
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-foreground">
                          {it.title}
                        </span>
                        {it.pinned && (
                          <Pin size={12} className="text-amber-300" />
                        )}
                      </div>
                      <div className="mt-1 text-[13px] leading-snug text-muted-foreground">
                        {it.body}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground/80">
                        <span>{t(`source.${it.source}`)}</span>
                        <span aria-hidden className="mx-1.5">·</span>
                        <span className="tabular-nums">{it.date}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3.5">
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"
        >
          <Plus size={14} />
          <span>{t('addManually')}</span>
        </button>
        {memory.lastUpdated && (
          <span className="text-xs text-muted-foreground">
            {t('lastUpdated', { date: memory.lastUpdated })}
          </span>
        )}
      </footer>
    </section>
  )
}
