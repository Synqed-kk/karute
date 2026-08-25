'use client'

// 案A (Liam, 7/17): bound segmented filter bar — the SAME visual component as
// the 自分/全スタッフ ScopeToggle (gray track, active = white pill + shadow),
// stretched full-width so every segment fits one line on 393px. Replaces the
// bordered filter pills that wrapped to two ragged lines on mobile.
//
// Shared control (Liam: same menu in a different location = same design):
// the 顧客 list status filter and the カルテ list record filter both render
// through here — one source of truth for the single-select list filter.

export interface FilterSegment<K extends string> {
  key: K
  label: string
  /** null = render the LABEL ALONE. Used by the カルテ list's 月ジャンプ
   *  (PR-2b): while a month is picked the bar's counts would be counted over
   *  that month's rows alone, so 今週 inside a past month would read 0 and
   *  すべて would name the month's size while the header names the store's.
   *  A count that can't be true is dropped rather than shown wrong. */
  count: number | null
}

export function SegmentedFilterBar<K extends string>({
  segments,
  active,
  onChange,
}: {
  segments: Array<FilterSegment<K>>
  active: K
  onChange: (key: K) => void
}) {
  return (
    <div className="flex h-9 w-full items-stretch rounded-full border border-border bg-muted/50 p-0.5 text-xs font-medium md:w-auto md:min-w-[420px]">
      {segments.map((s) => {
        const isActive = s.key === active
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(s.key)}
            className={`inline-flex flex-1 items-center justify-center gap-1 rounded-full px-2 transition-all ${
              isActive
                ? 'bg-card font-semibold text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="truncate">{s.label}</span>
            {s.count !== null && (
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {s.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
