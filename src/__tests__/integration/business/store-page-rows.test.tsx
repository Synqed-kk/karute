/**
 * @jest-environment jsdom
 */
// S49 P5a — お店ページ › 機能 as BEHAVIOUR: the rows, the OFF ask (spec D2/D3), subs (D4), chips, the source line,
// focus kept on the switch (not the mock's D27), and canEdit=false. FX-P5a: the switches are the room's Switch and
// the ask is the room's Dialog (Switch.tsx / Dialog.tsx, R93) — a scrim close is a press AND a release on the scrim.
import { useState } from 'react'
import { render, fireEvent, cleanup, screen, within } from '@testing-library/react'
import { StorePageRows, ROWS_HEAD, ROWS_SUB, sourceLine } from '@/app/[locale]/(business)/business/settings/StorePageRows'
import { REG, type CapKey } from '@/business/lib/store-page/copy'
import { seedRecord, type CapRecord, type Counts } from '@/business/lib/store-page/model'

afterEach(cleanup)

// mock STORES (:935-1004) shape: a store with live packs/posts and nothing else to show.
const COUNTS: Counts = { packs: 4, classes: 0, care: 2, posts: 3, questions: 3, products: 0, resources: 0 }

function Harness({ start, counts = COUNTS, canEdit = true, spy }: { start: CapRecord; counts?: Counts; canEdit?: boolean; spy?: (r: CapRecord) => void }) {
  const [draft, setDraft] = useState(start)
  return <StorePageRows draft={draft} saved={start} counts={counts} canEdit={canEdit} onChange={(n) => { spy?.(n); setDraft(n) }} />
}
const sw = (ja: string) => screen.getByRole('switch', { name: ja })
const on = (ja: string) => sw(ja).getAttribute('aria-checked') === 'true'
const rowOf = (key: CapKey) => document.querySelector(`[data-key="${key}"]`) as HTMLElement
const salon = () => seedRecord('esthetic_salon')

test('heading, sub and the 16 rows in REG order, each switch named by its row', () => {
  render(<Harness start={salon()} />)
  expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(ROWS_HEAD)
  expect(screen.getByText(ROWS_SUB)).toBeTruthy()
  expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual(REG.map((r) => r.ja))
  expect(document.querySelectorAll('.spr-row.is-sub')).toHaveLength(7)
})

test('turning ON never asks; a row with no off sentence or a 0 count turns OFF at once', () => {
  const spy = jest.fn()
  render(<Harness start={salon()} counts={{ ...COUNTS, packs: 0 }} spy={spy} />)
  fireEvent.click(sw('クラス')) // OFF → ON
  expect(on('クラス')).toBe(true)
  for (const ja of ['クラス', '受付QR', '回数券']) { // has-count classes 0 · no sentence · packs 0
    fireEvent.click(sw(ja))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(on(ja)).toBe(false)
  }
  fireEvent.click(sw('問診票')); fireEvent.click(sw('問診票')) // questions 3 but no off sentence
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(spy).toHaveBeenCalledTimes(6)
})

test('the ask fires for a sentence + live count; オフにする turns it off and focus returns to the switch', () => {
  render(<Harness start={salon()} />)
  fireEvent.click(sw('回数券'))
  const dlg = screen.getByRole('dialog', { name: '回数券をオフにしますか' })
  expect(within(dlg).getByText('お客様の残りの回数はそのまま使えます。新しい販売だけが止まります。')).toBeTruthy()
  expect(document.activeElement?.textContent).toBe('やめる')
  expect(on('回数券')).toBe(true)
  fireEvent.click(within(dlg).getByText('オフにする'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(on('回数券')).toBe(false)
  expect(document.activeElement).toBe(sw('回数券'))
})

test.each([
  ['やめる', (d: HTMLElement) => fireEvent.click(within(d).getByText('やめる'))],
  ['Esc', (d: HTMLElement) => fireEvent.keyDown(d, { key: 'Escape' })],
  ['scrim', (d: HTMLElement) => {
    const scrim = d.parentElement as HTMLElement
    fireEvent.mouseDown(scrim); fireEvent.mouseUp(scrim); fireEvent.click(scrim)
  }],
])('%s cancels through the shared Dialog: the switch stays ON and focus is back on it', (_n, cancel) => {
  const spy = jest.fn()
  render(<Harness start={salon()} spy={spy} />)
  fireEvent.click(sw('お知らせ')) // a bare click: the switch is not focused first (Safari's click)
  const dlg = screen.getByRole('dialog', { name: 'お知らせをオフにしますか' })
  expect(dlg.closest('.st-dlg-scrim')).toBe(dlg.parentElement) // the room's Dialog, not a local copy
  expect(document.activeElement).toBe(within(dlg).getByText('やめる')) // initialFocus = the cancel button
  cancel(dlg)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(on('お知らせ')).toBe(true)
  expect(spy).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(sw('お知らせ'))
})

test('a press that starts in the dialog box and is released on the scrim is not a scrim close', () => {
  render(<Harness start={salon()} />)
  fireEvent.click(sw('お知らせ'))
  const dlg = screen.getByRole('dialog')
  const scrim = dlg.parentElement as HTMLElement
  fireEvent.mouseDown(dlg); fireEvent.mouseUp(scrim); fireEvent.click(scrim)
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.mouseDown(scrim); fireEvent.mouseUp(dlg); fireEvent.click(scrim) // pressed on the scrim, released in the box
  expect(screen.getByRole('dialog')).toBeTruthy()
})

test('R92/R101: an UNKNOWN count draws no chip at all, and the OFF ask still fires', () => {
  const spy = jest.fn()
  render(<Harness start={salon()} counts={{ ...COUNTS, packs: undefined, posts: undefined }} spy={spy} />)
  expect(rowOf('packs').querySelector('.spr-chip')).toBeNull()
  expect(rowOf('posts').querySelector('.spr-chip')).toBeNull()
  expect(rowOf('homecare').querySelector('.spr-chip')?.textContent).toBe('お客様に表示中') // a known count still speaks
  fireEvent.click(sw('回数券'))
  expect(screen.getByRole('dialog', { name: '回数券をオフにしますか' })).toBeTruthy()
  expect(on('回数券')).toBe(true)
  expect(spy).not.toHaveBeenCalled()
})

test('Tab wraps inside the ask and skips a disabled button', () => {
  render(<Harness start={salon()} />)
  fireEvent.click(sw('ホームケア'))
  const dlg = screen.getByRole('dialog')
  const [no, yes] = within(dlg).getAllByRole('button')
  yes.focus(); fireEvent.keyDown(dlg, { key: 'Tab' })
  expect(document.activeElement).toBe(no)
  fireEvent.keyDown(dlg, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(yes)
  yes.setAttribute('disabled', '') // the trap reads live: a disabled button is never a stop
  no.focus()
  // やめる is now the LAST stop too: Tab is held inside (default prevented), never let past a disabled last button
  expect(fireEvent.keyDown(dlg, { key: 'Tab' })).toBe(false)
  expect(document.activeElement).toBe(no)
})

test('subs: dimmed + locked while the parent is OFF, keep their own value, come back as they were', () => {
  render(<Harness start={salon()} counts={{ ...COUNTS, posts: 0 }} />) // posts KNOWN 0 → no ask (an unknown count asks, R92)
  expect(on('読んでポイント')).toBe(true)
  expect(on('リアクション')).toBe(false)
  fireEvent.click(sw('お知らせ'))
  for (const [k, ja] of [['read_points', '読んでポイント'], ['reactions', 'リアクション']] as const) {
    expect(rowOf(k).classList.contains('is-dim')).toBe(true)
    expect(sw(ja).getAttribute('aria-disabled')).toBe('true')
  }
  fireEvent.click(sw('読んでポイント'))
  expect(on('読んでポイント')).toBe(true)
  fireEvent.click(sw('お知らせ'))
  expect(rowOf('read_points').classList.contains('is-dim')).toBe(false)
  expect(sw('読んでポイント').hasAttribute('aria-disabled')).toBe(false)
  expect([on('読んでポイント'), on('リアクション')]).toEqual([true, false])
})

test('chips: parents only — お客様に表示中 / 準備が必要 ・ {needJa}が0件 / オフ', () => {
  render(<Harness start={salon()} />)
  const chip = (k: CapKey) => rowOf(k).querySelector('.spr-chip')?.textContent ?? null
  expect(chip('packs')).toBe('お客様に表示中')
  expect(chip('classes')).toBe('オフ')
  fireEvent.click(sw('クラス'))
  expect(chip('classes')).toBe('準備が必要 ・ レッスンが0件')
  expect(rowOf('classes').querySelector('a, .addlink')).toBeNull() // D-ADD-LINK: no page to link to today
  expect(chip('photo_proof')).toBeNull()
})

test('focus stays on the switch after a plain toggle (not the mock D27)', () => {
  render(<Harness start={salon()} />)
  sw('受付QR').focus()
  fireEvent.click(sw('受付QR'))
  expect(document.activeElement).toBe(sw('受付QR'))
  expect(on('受付QR')).toBe(false)
})

test('canEdit=false: every switch locked, clicks change nothing and never ask', () => {
  const spy = jest.fn()
  render(<Harness start={salon()} canEdit={false} spy={spy} />)
  for (const s of screen.getAllByRole('switch')) {
    expect(s.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(s)
  }
  expect(spy).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('source line: 業種の標準, or the saved stamp in JST days with the role only when resolved', () => {
  const rec = seedRecord('esthetic_salon')
  const owned: CapRecord = { ...rec, switches: { ...rec.switches, packs: { on: false, source: 'OWNER', changed_at: '2026-09-13T15:30:00.000Z', changed_by: 'st-1' } } }
  expect(sourceLine(owned, 'checkin_qr')).toBe('業種の標準')
  expect(sourceLine(owned, 'packs', (id) => (id === 'st-1' ? '店長' : null))).toBe('お店で設定 ・ 9月14日 ・ 店長')
  expect(sourceLine(owned, 'packs', () => null)).toBe('お店で設定 ・ 9月14日')
  expect(sourceLine(owned, 'packs')).toBe('お店で設定 ・ 9月14日')
  const junk: CapRecord = { ...rec, switches: { ...rec.switches, packs: { on: false, source: 'OWNER', changed_at: 'nope' } } }
  expect(sourceLine(junk, 'packs')).toBe('お店で設定')
  // the line speaks for SAVED, not the draft
  render(<StorePageRows draft={rec} saved={owned} counts={COUNTS} canEdit onChange={() => {}} />)
  expect(rowOf('packs').querySelector('.spr-src')?.textContent).toBe('お店で設定 ・ 9月14日')
})
