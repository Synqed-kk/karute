'use client'
// お店ページ › 機能 (mock :815-819 markup, :1617-1714 behaviour) — a CONTROLLED block: it renders the draft and
// reports every flip through onChange; saving, stamping and the bar are the room's (P7).
// Not copied from the mock, on purpose: the focus loss after a flip (spec D27 — React keeps the switch node, and
// the ask hands focus back to it), the toast-only add link (D-ADD-LINK: no Business page adds packs / lessons /
// care / posts / questions / products / equipment today, so the chip shows without a link), the staff toast
// (D-STAFF: canEdit=false disables everything), and the demo stamp 「9月14日」/「店長」 (D-NOT-BUILT).
// R93: the switch is the room's ONE Switch (Switch.tsx) and the OFF ask the room's ONE Dialog (Dialog.tsx) — no
// local thumb css, no local dialog. A locked switch is aria-disabled, as the room's inert switches are.
// R95: this component imports its own css.
import { useId, useRef, useState } from 'react'

import { jstYmd } from '@/business/lib/clock'
import { ASK, REG, SOURCE, type CapKey } from '@/business/lib/store-page/copy'
import { asksBeforeOff, chipState, chipText, type CapRecord, type Counts } from '@/business/lib/store-page/model'
import { Dialog } from './Dialog'
import { Switch } from './Switch'
import './store-page-rows.css'

/** B7 heading + sub (mock :816-817), byte for byte. */
export const ROWS_HEAD = '機能'
export const ROWS_SUB = 'オンにすると、お客様のアプリのお店ページにその場所が出ます。出すものがまだ無いときは、用意できるまでお客様には出ません。'

export interface StorePageRowsProps {
  draft: CapRecord
  /** The stamps the source line speaks for are the SAVED record's (the draft's sources only change on save). */
  saved: CapRecord
  counts: Counts
  canEdit: boolean
  onChange: (next: CapRecord) => void
  /** The acting staff id in `changed_by` → its role word. Absent or unresolved → the line prints the date only. */
  roleOf?: (staffId: string) => string | null
  /** The room's reduced-motion answer for the switch springs; absent → read once from the media query. */
  reduced?: boolean
}

const withSwitch = (rec: CapRecord, key: CapKey, on: boolean): CapRecord =>
  ({ ...rec, switches: { ...rec.switches, [key]: { ...rec.switches[key], on } } })

/** The room's date words (`${m}月${d}日`, shifts/page.tsx:86) on the JST day; an unreadable stamp prints no date. */
const dayOf = (iso: string | undefined): string | null => {
  const t = iso === undefined ? NaN : Date.parse(iso)
  if (Number.isNaN(t)) return null
  const { m, d } = jstYmd(new Date(t))
  return `${m}月${d}日`
}
/** srcNote (:1620-1624) from P1's SOURCE; a part that cannot be resolved is left out, never invented. */
export function sourceLine(saved: CapRecord, key: CapKey, roleOf?: (id: string) => string | null): string {
  const s = saved.switches[key]
  if (s.source !== 'OWNER') return SOURCE.typeDefault
  const who = s.changed_by && roleOf ? roleOf(s.changed_by) : null
  return SOURCE.owner(dayOf(s.changed_at) ?? '', who ?? '').split(' ・ ').filter(Boolean).join(' ・ ')
}

/** The OS preference, read on the first client render (the room's useReducedMotion shape, SettingsScreen.tsx:266). */
const prefersReduced = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function StorePageRows({ draft, saved, counts, canEdit, onChange, roleOf, reduced }: StorePageRowsProps) {
  const [asking, setAsking] = useState<CapKey | null>(null)
  const [osReduced] = useState(prefersReduced)
  const rows = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()

  /** The ONE end of the ask. The Dialog hands focus back to its opener (the switch) when it closes. */
  const close = (next: CapRecord | null) => {
    setAsking(null)
    if (next) onChange(next)
  }

  const toggle = (key: CapKey, locked: boolean) => {
    if (asking) return // R184: a press behind an open ask (AT cursor, script) changes nothing
    if (locked) return
    if (asksBeforeOff(key, draft, counts)) {
      // The Dialog takes the focused control as its opener. A click does not focus a button in every browser
      // (Safari), so the switch is focused here first — focus then returns to it on every close path.
      rows.current?.querySelector<HTMLElement>(`[data-key="${key}"] [role="switch"]`)?.focus()
      setAsking(key)
      return
    }
    onChange(withSwitch(draft, key, !draft.switches[key].on))
  }

  const row = REG.find((r) => r.key === asking)
  /** R184: the row's lock read again at confirm — a section locked under the open ask only closes it. */
  const rowLocked = !!row && (!canEdit || (!!row.parent && !draft.switches[row.parent].on))

  return (
    <div className="st-block spr">
      <div className="st-block-head"><h3>{ROWS_HEAD}</h3></div>
      <p className="st-block-note">{ROWS_SUB}</p>
      <div className="spr-rows" ref={rows}>
        {REG.map((r) => {
          const parentOff = !!r.parent && !draft.switches[r.parent].on
          const locked = !canEdit || parentOff
          const chip = chipState(r.key, draft, counts)
          return (
            <div key={r.key} className={`spr-row${r.parent ? ' is-sub' : ''}${parentOff ? ' is-dim' : ''}`} data-key={r.key}>
              <div>
                <div className="spr-head">
                  <span className="spr-name">{r.ja}</span>
                  {chip && <span className={`spr-chip is-${chip}`}>{chipText(r.key, draft, counts)}</span>}
                </div>
                <div className="spr-desc">{r.desc}</div>
                <div className="spr-src">{sourceLine(saved, r.key, roleOf)}</div>
              </div>
              <Switch
                on={draft.switches[r.key].on}
                aria={r.ja}
                inert={locked ? { 'aria-disabled': 'true' } : {}}
                reduced={reduced ?? osReduced}
                onToggle={() => toggle(r.key, locked)}
              />
            </div>
          )
        })}
      </div>
      <Dialog open={row !== undefined} onClose={() => close(null)} labelledBy={titleId} describedBy={bodyId} initialFocus={cancelRef} className="spr-dlg">
        {row && (
          <>
            <h4 id={titleId}>{ASK.title(row.ja)}</h4>
            <p id={bodyId}>{row.off}</p>
            <div className="spr-acts">
              <button type="button" className="spr-cancel" ref={cancelRef} onClick={() => close(null)}>{ASK.cancel}</button>
              <button type="button" className="spr-commit" onClick={() => close(rowLocked ? null : withSwitch(draft, row.key, false))}>{ASK.confirm}</button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  )
}
