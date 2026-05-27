'use client'

import { useState } from 'react'
import { CheckCircle, ChevronDown, Clipboard } from 'lucide-react'

export interface CustomerSessionEntry {
  id: string
  karuteId: string | null
  date: string // pretty: "Mar 22, 2026"
  weekday: string // "Sun"
  service: string
  duration: number // minutes
  summary: string
  staffName: string
  entryCount: number
  aiSummarized: boolean
  memoryAdded?: number | null
  isLatest?: boolean
}

interface SessionsTabContentProps {
  sessions: CustomerSessionEntry[]
}

export function SessionsTabContent({ sessions }: SessionsTabContentProps) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/15 text-sky-300">
            <Clipboard size={14} />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Session history</h3>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {sessions.length} sessions
        </span>
      </header>

      {sessions.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-muted-foreground">
          No sessions recorded yet.
        </p>
      ) : (
        <ul className="flex flex-col">
          {sessions.map((s) => (
            <SessionRow key={s.id} s={s} />
          ))}
        </ul>
      )}
    </section>
  )
}

function SessionRow({ s }: { s: CustomerSessionEntry }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[80px_minmax(0,1fr)_16px] items-start gap-3 py-3 text-left hover:bg-muted/30"
      >
        <div className="flex flex-col">
          <span className="text-xs font-semibold tabular-nums text-foreground">
            {s.date}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {s.weekday}
            {s.isLatest && (
              <span className="ml-1 text-[10px] font-medium text-sky-300">
                latest
              </span>
            )}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {s.service}
            </span>
            {/* Duration hidden when 0 — karute_records doesn't have a
             *  `duration_minutes` column yet so every row would have
             *  read "0 min" as if it were real data. Same pattern as
             *  the karute list row's gating. ANTHONY: when the column
             *  ships, the conditional auto-shows real values. */}
            {s.duration > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {s.duration} min
              </span>
            )}
          </div>
          <p className="line-clamp-2 text-xs text-muted-foreground">{s.summary}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{s.staffName}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{s.entryCount} entries</span>
            {s.aiSummarized && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                  <CheckCircle size={10} />
                  AI summarized
                </span>
              </>
            )}
            {typeof s.memoryAdded === 'number' && s.memoryAdded > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">
                  +{s.memoryAdded} memory
                </span>
              </>
            )}
          </div>
        </div>
        <ChevronDown
          size={14}
          className={`mt-1 shrink-0 text-muted-foreground transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-border bg-background/30 px-4 py-3 text-xs text-muted-foreground">
          {s.karuteId ? (
            <a
              href={`/karute/${s.karuteId}`}
              className="text-sky-400 hover:text-sky-300"
            >
              Open full karute record →
            </a>
          ) : (
            <span>No karute record linked to this session yet.</span>
          )}
        </div>
      )}
    </li>
  )
}
