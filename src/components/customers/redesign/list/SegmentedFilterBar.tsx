'use client'

// 案A (Liam, 7/17): bound segmented filter bar — the SAME visual component as
// the 自分/全スタッフ ScopeToggle (gray track, active = white pill + shadow),
// stretched full-width so every segment fits one line on 393px. Replaces the
// bordered filter pills that wrapped to two ragged lines on mobile.
//
// Shared control (Liam: same menu in a different location = same design):
// the 顧客 list status filter and the カルテ list record filter both render
// through here — one source of truth for the single-select list filter.
//
// Two looks, one component (⚖ S44):
//  - 'track' (顧客, build 29, unchanged): the gray track, active = white pill.
//  - 'words' (カルテ, ⚖ LOCKED 01:56): the same row without its chrome — plain
//    words, the chosen one bold + blue + a light blue wash (the R13 selected
//    recipe), no ✓. Same 36px row, same 30px pill, same type as the track.
//
// ⚖ FIT BY DESIGN (Liam 04:2x) — 「all counts when room, urgent-only when
// tight, slide last」 is a set of WIDTH STEPS (viewport breakpoints, chosen from
// the real longest labels and locked by the fit test), never measured
// overflow; nothing here measures anything at runtime:
//   step A (room)  every word shows its count;
//   step B (tight) counts only on the urgent words (the caller names them);
//   step C (last)  this row alone may slide sideways.
// 詰めて固定: before each step change the gaps tighten to the app's next-
// smaller token (words: px-1.5 → px-1 and gap-2 → gap-1; track: px-2 →
// px-1.5). Nothing ever wraps to a second line.
//
// The breakpoints live with each caller (its words, its languages) as
// literal class strings; the arithmetic that chose them is in the caller's
// comment and the fit test (scripts/fit-harness/run.mjs) locks them.

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

/** The width steps for one row in one language — literal class strings so
 *  Tailwind emits them (it reads source text, never composed names). */
export interface WidthSteps {
  /** On the row: the tightened-gap bands, and step C (the row may slide). */
  row: string
  /** On each word: the tightened-padding bands (and, on the track, keeping
   *  its full width while the row slides). */
  item: string
  /** On each NON-urgent word's count: hidden from step B down. */
  count: string
}

export const NO_STEPS: WidthSteps = { row: '', item: '', count: '' }

export function SegmentedFilterBar<K extends string>({
  segments,
  active,
  onChange,
  variant = 'track',
  steps = NO_STEPS,
  urgent = [],
}: {
  segments: Array<FilterSegment<K>>
  active: K
  onChange: (key: K) => void
  variant?: 'track' | 'words'
  steps?: WidthSteps
  /** The urgent words (要対応 family) that keep their count at step B. */
  urgent?: readonly K[]
}) {
  const words = variant === 'words'
  return (
    <div
      data-words-row={variant}
      className={[
        words
          ? // The track minus its chrome: same h-9 box, same p-0.5 inset, a
            // transparent border so the pill lands on the same 30px.
            'flex h-9 w-full items-stretch justify-between gap-2 rounded-full border border-transparent p-0.5 text-xs font-medium md:w-auto md:justify-start'
          : 'flex h-9 w-full items-stretch rounded-full border border-border bg-muted/50 p-0.5 text-xs font-medium md:w-auto md:min-w-[420px]',
        steps.row,
      ].join(' ')}
    >
      {segments.map((s) => {
        const isActive = s.key === active
        const isUrgent = urgent.includes(s.key)
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(s.key)}
            className={[
              words
                ? // px-1.5 = the wash's 6px inset around the chosen word.
                  'inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-1.5 transition-all'
                : // flex-auto + min-w-0 (S44, the census's truncate gap): each
                  // segment starts at its own content and shares the leftover
                  // equally, so a longer word (要フォロー) never truncates while
                  // the row fits; `truncate` is only the last backstop now
                  // (with flex-1's zero basis + min-w-0 every word would be
                  // forced to an equal share and 要フォロー would clip).
                  'inline-flex min-w-0 flex-auto items-center justify-center gap-1 rounded-full px-2 transition-all',
              isActive
                ? words
                  ? 'bg-primary/8 font-semibold text-primary'
                  : 'bg-card font-semibold text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
              steps.item,
            ].join(' ')}
          >
            <span className={words ? undefined : 'truncate'}>{s.label}</span>
            {s.count !== null && (
              <span
                data-count={isUrgent ? 'urgent' : 'plain'}
                className={[
                  'text-[10px] tabular-nums text-muted-foreground',
                  isUrgent ? '' : steps.count,
                ].join(' ')}
              >
                {s.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
