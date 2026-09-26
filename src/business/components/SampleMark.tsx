'use client'

// ── ⚖ PR-3 — the 「サンプル」 mark ────────────────────────────────────────────
//
// ONE token (`.sample-mark` in the shell sheet, amber wash — never black), ONE
// string home (`businessStrings.sampleMark`). The chip opens its two-line
// explanation on the room's ONE disclosure (`Collapse` → `makeSpring`): no
// second easing, and an inline panel rather than a floating popover because
// that is the shape `Collapse` has. Esc on the chip closes it; focus never left
// the chip, so it is already where it returns to.
//
// ⚖ PR-4c §v7 V7-1 — ONE home for both rooms that draw it (設定, 今日の運営), moved
// verbatim out of SettingsScreen.tsx; the first shared Business component. `Collapse`
// stays in settings/ (react + the spring only, so no cycle).

import { useState } from 'react'
import { Collapse } from '@/app/[locale]/(business)/business/settings/Collapse'
import { businessStrings, sampleMarkLines } from '@/business/i18n'

/** The mark's form as the string home reads it (whole, or named parts); both rooms' payloads fit it. */
export type SampleMarkForm = Parameters<typeof sampleMarkLines>[0]

const MARK = businessStrings.sampleMark

export function MarkChip({ mark, open, controls, onToggle }: { mark: SampleMarkForm; open: boolean; controls: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="sample-mark"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={MARK.chipLabel}
      data-guide-title={MARK.popLabel}
      data-guide={`${sampleMarkLines(mark).pop1}${MARK.popLine2}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          onToggle()
        }
      }}
    >
      {MARK.chip}
    </button>
  )
}

/** The note line, and under it the chip's explanation on `Collapse`. ⚖ §v3 V3-3 —
 *  both say the mark's FORM: the whole block, or only its named parts. */
export function MarkNote({ mark, id, open, reduced }: { mark: SampleMarkForm; id: string; open: boolean; reduced: boolean }) {
  const lines = sampleMarkLines(mark)
  return (
    <>
      <p className="sample-mark-note">{lines.note}</p>
      <Collapse open={open} id={id} reduced={reduced}>
        <div className="sample-pop" role="note" aria-label={MARK.popLabel}>
          <p>{lines.pop1}</p>
          <p>{MARK.popLine2}</p>
        </div>
      </Collapse>
    </>
  )
}

/** A section's mark (予約と確保): chip + note on one line under the lead. ⚖ §v3
 *  V3-6 — it is the section's ONLY mark: its blocks draw none (see SettingsScreen's `Block`). */
export function SampleMark({ mark, id, reduced }: { mark: SampleMarkForm; id: string; reduced: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="sample-mark-line">
      <MarkChip mark={mark} open={open} controls={id} onToggle={() => setOpen((o) => !o)} />
      <MarkNote mark={mark} id={id} open={open} reduced={reduced} />
    </div>
  )
}
