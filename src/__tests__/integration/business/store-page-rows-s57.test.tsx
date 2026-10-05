/**
 * @jest-environment jsdom
 */
// S57 P5a — the switch rows' fix round (R184 second nets, attack findings 1, 4, 5, 6 + Sonnet NIT 2).
// Sources: L57/ATTACK-S57-P5A-OPUS.md scratch A2, A3, A4, A10, A11 (A2/A3/A4 inverted to the fixed behaviour).
import { useState } from 'react'
import { render, fireEvent, cleanup, screen, within, act } from '@testing-library/react'
import { StorePageRows } from '@/app/[locale]/(business)/business/settings/StorePageRows'
import { seedRecord, resetDiff, type CapRecord, type Counts } from '@/business/lib/store-page/model'

afterEach(cleanup)
const COUNTS: Counts = { packs: 4, classes: 0, care: 2, posts: 3, questions: 3, products: 0, resources: 0 }
const sw = (ja: string) => screen.getByRole('switch', { name: ja })
const on = (ja: string) => sw(ja).getAttribute('aria-checked') === 'true'

// A11 — a flip must keep the switch's source: 戻す (resetDiff) keeps OWNER keys by reading the DRAFT's source.
test('A11 flipping an OWNER switch keeps source OWNER in the draft, so 戻す still KEEPS it', () => {
  const rec = seedRecord('esthetic_salon')
  const start: CapRecord = { ...rec, switches: { ...rec.switches, packs: { on: true, source: 'OWNER', changed_at: '2026-09-13T15:30:00.000Z', changed_by: 'st-1' } } }
  let last: CapRecord = start
  function H() { const [d, setD] = useState(start); return <StorePageRows draft={d} saved={start} counts={{ ...COUNTS, packs: 0 }} canEdit onChange={(n) => { last = n; setD(n) }} /> }
  render(<H />)
  fireEvent.click(sw('回数券')) // packs known 0 → no ask, straight OFF
  expect(last.switches.packs.on).toBe(false)
  expect(resetDiff(last).keeps).toContain('packs')
  expect(resetDiff(last).flips.map((f) => f.key)).not.toContain('packs')
})

// A2 inverted (finding 4) — canEdit drops while the ask is open: オフにする only closes.
test('A2 canEdit flips false while the ask is open: オフにする closes the ask and calls no onChange', () => {
  const spy = jest.fn()
  let lock = () => {}
  function H() {
    const [canEdit, setCanEdit] = useState(true)
    const [draft, setDraft] = useState(seedRecord('esthetic_salon'))
    lock = () => setCanEdit(false)
    return <StorePageRows draft={draft} saved={draft} counts={COUNTS} canEdit={canEdit} onChange={(n) => { spy(n); setDraft(n) }} />
  }
  render(<H />)
  fireEvent.click(sw('回数券'))
  act(() => lock())
  expect(sw('回数券').getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(within(screen.getByRole('dialog')).getByText('オフにする'))
  expect(spy).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(on('回数券')).toBe(true)
})

// A3 inverted (finding 5) — another row's switch pressed behind the open ask is ignored.
test('A3 a second row pressed under the open ask: the question does not change, focus stays in the dialog', () => {
  const spy = jest.fn()
  function H() { const [d, setD] = useState(seedRecord('esthetic_salon')); return <StorePageRows draft={d} saved={d} counts={COUNTS} canEdit onChange={(n) => { spy(n); setD(n) }} /> }
  render(<H />)
  fireEvent.click(sw('回数券'))
  const before = screen.getByRole('dialog').querySelector('h4')?.textContent
  fireEvent.click(sw('お知らせ'))
  const dlg = screen.getByRole('dialog')
  expect(dlg.querySelector('h4')?.textContent).toBe(before)
  expect(screen.getByRole('dialog', { name: '回数券をオフにしますか' })).toBe(dlg)
  expect(dlg.contains(document.activeElement)).toBe(true)
  expect(spy).not.toHaveBeenCalled()
  fireEvent.click(within(dlg).getByText('オフにする'))
  expect([on('回数券'), on('お知らせ')]).toEqual([false, true])
})

// A4 inverted (finding 5) — the SAME switch pressed again under the open ask keeps focus inside the modal.
test('A4 the same switch pressed again under the open ask: focus stays inside the dialog', () => {
  function H() { const [d, setD] = useState(seedRecord('esthetic_salon')); return <StorePageRows draft={d} saved={d} counts={COUNTS} canEdit onChange={setD} /> }
  render(<H />)
  fireEvent.click(sw('回数券'))
  fireEvent.click(sw('回数券'))
  const dlg = screen.getByRole('dialog')
  expect(dlg.contains(document.activeElement)).toBe(true)
  expect(document.activeElement).not.toBe(sw('回数券'))
})

// finding 6 — the dialog is described by its body paragraph.
test('the ask dialog: aria-describedby equals the id of its body paragraph', () => {
  function H() { const [d, setD] = useState(seedRecord('esthetic_salon')); return <StorePageRows draft={d} saved={d} counts={COUNTS} canEdit onChange={setD} /> }
  render(<H />)
  fireEvent.click(sw('回数券'))
  const dlg = screen.getByRole('dialog')
  const p = dlg.querySelector('p')!
  expect(p.id).not.toBe('')
  expect(dlg.getAttribute('aria-describedby')).toBe(p.id)
})

// A10, third case (Sonnet NIT 2) — the room's `reduced` prop beats the OS setting.
describe('A10 reduced motion', () => {
  const mm = (matches: boolean) => { (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) }
  afterEach(() => { delete (window as unknown as { matchMedia?: unknown }).matchMedia })
  const thumb = (ja: string) => (sw(ja).querySelector('.st-switch-thumb') as HTMLElement).style.getPropertyValue('--st-sw-p')
  function H({ reduced }: { reduced?: boolean }) { const [d, setD] = useState(seedRecord('esthetic_salon')); return <StorePageRows draft={d} saved={d} counts={COUNTS} canEdit onChange={setD} reduced={reduced} /> }
  test('prop reduced=false beats OS reduce', () => { mm(true); render(<H reduced={false} />); fireEvent.click(sw('受付QR')); expect(thumb('受付QR')).not.toBe('0.0000') })
})
