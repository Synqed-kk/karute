'use client'

// お店ページ — the 業種 block (mock :799-812) and its 「業種の標準に戻す」 diff dialog (openTypeDialog, mock :1719-1764).
// A controlled piece: the room owns the draft AND its reset keys; this block only proposes the next ones.
// ⚖ R140 / B6: ONE native select holding Karute's 26 types (businessProfiles' labels, R142), pre-filled from the
// record's business_type (the door seeds it from the store's type, R162). RECORD-ONLY: the pick writes the record's
// business_type, nothing else (R162). Picking a type sets business_type on the draft FIRST and only then computes the
// diff (R144 — resetDiff / applyReset take the record alone and read its type); D7: no switch moves by itself, the
// pick opens NO dialog (R183) and keeps the reset keys (R182, R156's clear withdrawn). Only the outline button
// shows the diff for the current type (D8). The diff counts unsaved flips and keeps OWNER keys (P1 resetDiff); 戻す
// applies P1 applyReset — never the OFF ask (D9) — and the flipped keys keep source TYPE_DEFAULT (D-RESET).
// R93: the dialog is the room's shared Dialog.tsx. Every string is P1's copy.ts (mock verbatim, R82).
import { useRef, useState } from 'react'
import { REG, RESET, TYPE_BLOCK } from '@/business/lib/store-page/copy'
import {
  BUSINESS_TYPE_KEYS, applyReset, resetDiff, typeKeyOf, type BusinessTypeKey, type CapKey, type CapRecord,
} from '@/business/lib/store-page/model'
import { labelOf } from '@/business/lib/store-page/type-labels'
import { Dialog } from './Dialog'
import './store-page-type.css'

const jaOf = (k: CapKey): string => REG.find((r) => r.key === k)?.ja ?? k

/** R156 — the reset keys (the save body's `reset_keys`, stampSave's resetKeys) live with the draft in the room. This
 *  block reports every change to them as an updater the room applies to its own state: a type pick leaves them as
 *  they are (R182 — stampSave keeps a stamp only when the value equals the FINAL type's default); 戻す adds the keys it flipped. */
export type ResetKeysUpdate = (prev: readonly CapKey[]) => readonly CapKey[]

export interface StorePageTypeProps {
  draft: CapRecord
  /** Part of the store-page blocks' uniform props; this block reads the draft only (the diff counts unsaved flips). */
  saved: CapRecord
  canEdit: boolean
  onChange: (next: CapRecord) => void
  onResetKeys: (update: ResetKeysUpdate) => void
  onToast: (text: string) => void
  /** R211 — the tour's pair for this block, on its own element (ReserveCardLookSection's shape). */
  guide?: { title: string; guide: string }
}

export function StorePageType({ draft, canEdit, onChange, onResetKeys, onToast, guide }: StorePageTypeProps) {
  /** The type the open dialog speaks for; null = closed. */
  const [ask, setAsk] = useState<BusinessTypeKey | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const current = typeKeyOf(draft.business_type)

  const pick = (raw: string) => {
    if (!canEdit) return
    const t = typeKeyOf(raw)
    onChange({ ...draft, business_type: t }) // D7 / R183: the type alone — no dialog, the reset keys kept (R182)
  }
  // R144: the asked record carries the picked type before any diff / reset is computed from it.
  const asked: CapRecord | null = ask ? { ...draft, business_type: ask } : null
  const diff = asked ? resetDiff(asked) : null
  // Editing withdrawn while the dialog is open: 戻す goes dead and confirm refuses, like pick (the opener is already disabled).
  const confirm = () => {
    if (!canEdit || !ask || !asked || !diff) return
    const flipped = diff.flips.map((f) => f.key)
    onResetKeys((prev) => [...prev, ...flipped.filter((k) => !prev.includes(k))])
    onChange(applyReset(asked))
    onToast(RESET.toast(labelOf(ask)))
    setAsk(null)
  }

  return (
    <section className="st-block sp-type" data-guide-title={guide?.title} data-guide={guide?.guide}>
      <div className="st-block-head">
        <h3 id="spTypeHead">{TYPE_BLOCK.title}</h3>
      </div>
      <p className="st-block-note">{TYPE_BLOCK.sub}</p>
      <div className="sp-typerow">
        <select
          className="st-select sp-type-select"
          aria-label={TYPE_BLOCK.title}
          value={current}
          disabled={!canEdit}
          onChange={(e) => pick(e.target.value)}
        >
          {BUSINESS_TYPE_KEYS.map((t) => (
            <option key={t} value={t}>{labelOf(t)}</option>
          ))}
        </select>
        {/* R197: the Dialog takes the focused control as its opener, and Safari does not focus a button on click —
            so the button focuses itself first, and every close path gives the focus back to it. */}
        <button type="button" className="btn sp-type-reset" disabled={!canEdit} onClick={(e) => { e.currentTarget.focus(); setAsk(current) }}>
          {RESET.button}
        </button>
      </div>

      <Dialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        labelledBy="spTypeDlgTitle"
        describedBy="spTypeDlgBody"
        initialFocus={cancelRef}
        className="sp-type-dlg"
      >
        {ask && diff && (
          <>
            <h4 id="spTypeDlgTitle">{RESET.title}</h4>
            <p id="spTypeDlgBody">{RESET.body(labelOf(ask))}</p>
            <div className="sp-type-diff">
              {diff.none && <div><span className="v nochg">{RESET.none}</span></div>}
              {diff.flips.map((f) => (
                <div key={f.key} data-key={f.key}><span className="k">{jaOf(f.key)}</span><span className="v">{RESET.flip(f.from, f.to)}</span></div>
              ))}
              {diff.keeps.map((k) => (
                <div key={k} data-key={k}><span className="k">{jaOf(k)}</span><span className="v nochg">{RESET.keep}</span></div>
              ))}
            </div>
            <div className="sp-type-acts">
              <button type="button" className="btn" ref={cancelRef} onClick={() => setAsk(null)}>{RESET.cancel}</button>
              <button type="button" className="btn primary" disabled={!canEdit || diff.none} onClick={confirm}>{RESET.confirm}</button>
            </div>
          </>
        )}
      </Dialog>
    </section>
  )
}
