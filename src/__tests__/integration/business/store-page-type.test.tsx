/**
 * @jest-environment jsdom
 */
// S55 FX-P5b — the 業種 block + 業種の標準に戻す diff dialog as BEHAVIOUR: ONE native select with Karute's 26 types
// (R140 / B6), labels = businessProfiles' (R142 / B13), the type set FIRST and only then the diff (R144), every pick
// clears the reset keys (R156), D7/D8/D9, D-RESET, and the room's shared Dialog (R93: Esc · scrim · やめる, focus back,
// a disabled 戻す skipped by the trap). A harness plays the room: it owns the draft and the reset keys.
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StorePageType, type ResetKeysUpdate } from '@/app/[locale]/(business)/business/settings/StorePageType'
import { REG } from '@/business/lib/store-page/copy'
import { TYPE_LABEL } from '@/business/lib/store-page/type-labels'
import { businessProfiles } from '@/business/lib/fixtures-settings'
import {
  BUSINESS_TYPE_KEYS, applyReset, resetDiff, seedRecord, type BusinessTypeKey, type CapKey, type CapRecord,
} from '@/business/lib/store-page/model'

afterEach(cleanup)

const with_ = (rec: CapRecord, key: CapKey, on: boolean, source: 'TYPE_DEFAULT' | 'OWNER' = 'TYPE_DEFAULT'): CapRecord => ({
  ...rec,
  switches: { ...rec.switches, [key]: { on, source } },
})
const typed = (rec: CapRecord, t: BusinessTypeKey): CapRecord => ({ ...rec, business_type: t })

/** live=false: the room never applies onChange — so whatever the dialog shows was computed from the block's own
 *  type-first record, not from a re-rendered draft (the R144 order pin). */
function mount(start: CapRecord, opts: { canEdit?: boolean; live?: boolean; keys?: readonly CapKey[] } = {}) {
  const { canEdit = true, live = true, keys = [] } = opts
  const changes: CapRecord[] = []
  const toasts: string[] = []
  const log: string[] = []
  let current = start
  let resetKeys: readonly CapKey[] = keys
  function Harness() {
    const [draft, setDraft] = useState(start)
    const [rk, setRk] = useState<readonly CapKey[]>(keys)
    current = draft
    resetKeys = rk
    return (
      <div className="page pg-settings">
        <StorePageType
          draft={draft}
          saved={start}
          canEdit={canEdit}
          onChange={(n) => { log.push('change'); changes.push(n); if (live) setDraft(n) }}
          onResetKeys={(u: ResetKeysUpdate) => { log.push('keys'); setRk((p) => u(p)) }}
          onToast={(t) => toasts.push(t)}
        />
      </div>
    )
  }
  render(<Harness />)
  return { changes, toasts, log, draft: () => current, resetKeys: () => resetKeys }
}
const select = () => screen.getByRole('combobox', { name: '業種' }) as HTMLSelectElement
const pick = (t: BusinessTypeKey) => { select().focus(); fireEvent.change(select(), { target: { value: t } }) }
const dialog = () => screen.queryByRole('dialog', { name: '業種の標準に戻しますか' })
const lines = () => Array.from(dialog()!.querySelectorAll('.sp-type-diff > div')).map((d) =>
  Array.from(d.querySelectorAll('span')).map((s) => s.textContent))
/** What the dialog must show for a record, from the model itself (single-argument). */
const expectedLines = (rec: CapRecord) => {
  const d = resetDiff(rec)
  const ja = (k: CapKey) => REG.find((r) => r.key === k)?.ja
  return [
    ...(d.none ? [['変わるところはありません']] : []),
    ...d.flips.map((f) => [ja(f.key), (f.from ? 'オン' : 'オフ') + ' → ' + (f.to ? 'オン' : 'オフ')]),
    ...d.keeps.map((k) => [ja(k), '変更なし（お店で設定済み）']),
  ]
}

describe('業種 select — 26 types, businessProfiles labels', () => {
  it('every BUSINESS_TYPE_KEYS key has the label businessProfiles gives it', () => {
    expect(BUSINESS_TYPE_KEYS).toHaveLength(26)
    for (const k of BUSINESS_TYPE_KEYS) expect(TYPE_LABEL[k]).toBe(businessProfiles.find((p) => p.value === k)?.label)
  })

  it('draws h3, sub, ONE select with the 26 options and the outline button; pre-filled from the record', () => {
    mount(seedRecord('yoga_studio'))
    expect(screen.getByRole('heading', { level: 3, name: '業種' })).toBeTruthy()
    expect(screen.getByText('業種は、下の機能の「標準の組み合わせ」を決めるためのものです。選んでも、その場では何も変わりません。')).toBeTruthy()
    const opts = Array.from(select().options)
    expect(opts.map((o) => o.value)).toEqual([...BUSINESS_TYPE_KEYS])
    expect(opts.map((o) => o.textContent)).toEqual(BUSINESS_TYPE_KEYS.map((k) => businessProfiles.find((p) => p.value === k)!.label))
    expect(select().value).toBe('yoga_studio')
    expect(screen.getByRole('button', { name: '業種の標準に戻す' })).toBeTruthy()
    expect(dialog()).toBeNull()
  })

  it('a junk business_type pre-fills as other', () => {
    mount({ ...seedRecord('hair_salon'), business_type: 'SALON' } as unknown as CapRecord) // an old family-name record
    expect(select().value).toBe('other')
  })
})

describe('a type pick (R144 · R156 · D7)', () => {
  it('sets business_type FIRST (switches untouched), and the diff shown is the PICKED type\'s', () => {
    const start = seedRecord('hair_salon')
    const h = mount(start)
    pick('yoga_studio')
    expect(h.changes).toHaveLength(1)
    expect(h.changes[0]).toEqual(typed(start, 'yoga_studio'))
    fireEvent.click(screen.getByRole('button', { name: '業種の標準に戻す' })) // R183: the dialog opens from the button only
    expect(dialog()!.textContent).toContain('業種「' + businessProfiles.find((p) => p.value === 'yoga_studio')!.label + '」の標準の組み合わせにします。')
    const want = resetDiff(typed(start, 'yoga_studio'))
    expect(want.none).toBe(false)
    expect(lines()).toEqual(expectedLines(typed(start, 'yoga_studio')))
    expect(lines()).toHaveLength(want.flips.length + want.keeps.length)
  })

  it('a pick leaves the reset keys exactly as they were (R182)', () => {
    const h = mount(seedRecord('hair_salon'), { keys: ['shop'] })
    pick('yoga_studio')
    expect(h.resetKeys()).toEqual(['shop'])
    expect(h.log).toEqual(['change'])
    fireEvent.click(screen.getByRole('button', { name: '業種の標準に戻す' }))
    fireEvent.click(screen.getByRole('button', { name: '戻す' }))
    const flipped = resetDiff(typed(seedRecord('hair_salon'), 'yoga_studio')).flips.map((f) => f.key)
    const after = ['shop', ...flipped.filter((k) => k !== 'shop')]
    expect(h.resetKeys()).toEqual(after)
    pick('hair_salon')
    expect(h.resetKeys()).toEqual(after)
  })

  it('D9 / D-RESET: 戻す = applyReset(record with the picked type) — OWNER kept, toast verbatim, focus back on the button', async () => {
    const start = with_(seedRecord('hair_salon'), 'posts', !seedRecord('hair_salon').switches.posts.on, 'OWNER')
    const h = mount(start)
    pick('personal_gym')
    screen.getByRole('button', { name: '業種の標準に戻す' }).focus(); fireEvent.click(screen.getByRole('button', { name: '業種の標準に戻す' }))
    fireEvent.click(screen.getByRole('button', { name: '戻す' }))
    expect(dialog()).toBeNull()
    expect(h.draft()).toEqual(applyReset(typed(start, 'personal_gym')))
    expect(h.draft().switches.posts).toEqual(start.switches.posts)
    expect(h.toasts).toEqual(['業種「' + businessProfiles.find((p) => p.value === 'personal_gym')!.label + '」の標準に戻しました。保存するとお客様のアプリに反映されます'])
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '業種の標準に戻す' })))
  })
})

describe('the diff dialog — the shared Dialog (R93)', () => {
  it('D8: the outline button opens the current type\'s diff and changes nothing', () => {
    const h = mount(with_(seedRecord('hair_salon'), 'shop', !seedRecord('hair_salon').switches.shop.on))
    fireEvent.click(screen.getByRole('button', { name: '業種の標準に戻す' }))
    expect(h.changes).toHaveLength(0)
    expect(lines()).toEqual([['物販', seedRecord('hair_salon').switches.shop.on ? 'オフ → オン' : 'オン → オフ']])
  })

  const scrimClick = () => {
    const s = dialog()!.parentElement!
    fireEvent.pointerDown(s); fireEvent.mouseDown(s); fireEvent.pointerUp(s); fireEvent.mouseUp(s); fireEvent.click(s)
  }
  it.each([
    ['やめる', () => fireEvent.click(screen.getByRole('button', { name: 'やめる' }))],
    ['Esc', () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' })],
    ['scrim', scrimClick],
  ])('%s closes it: the picked type stays, no switch moves, no toast, focus back on the button', async (_n, cancel) => {
    const start = seedRecord('hair_salon')
    const h = mount(start)
    pick('yoga_studio')
    screen.getByRole('button', { name: '業種の標準に戻す' }).focus(); fireEvent.click(screen.getByRole('button', { name: '業種の標準に戻す' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'やめる' })))
    cancel()
    expect(dialog()).toBeNull()
    expect(h.draft()).toEqual(typed(start, 'yoga_studio'))
    expect(h.toasts).toEqual([])
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '業種の標準に戻す' })))
  })

  it('a press inside the panel is not a scrim cancel', () => {
    mount(seedRecord('hair_salon'))
    pick('yoga_studio')
    fireEvent.click(screen.getByRole('button', { name: '業種の標準に戻す' }))
    const p = dialog()!
    fireEvent.pointerDown(p); fireEvent.mouseDown(p); fireEvent.pointerUp(p); fireEvent.mouseUp(p); fireEvent.click(p)
    expect(dialog()).not.toBeNull()
  })

  it('none-case: 変わるところはありません, 戻す disabled, and the trap skips it', async () => {
    mount(seedRecord('dental_clinic'))
    fireEvent.click(screen.getByRole('button', { name: '業種の標準に戻す' }))
    expect(lines()).toEqual([['変わるところはありません']])
    const yes = screen.getByRole('button', { name: '戻す' }) as HTMLButtonElement
    const no = screen.getByRole('button', { name: 'やめる' })
    expect(yes.disabled).toBe(true)
    await waitFor(() => expect(document.activeElement).toBe(no))
    expect(fireEvent.keyDown(no, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(no)
    expect(fireEvent.keyDown(no, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(no)
  })

  it('the trap wraps between やめる and an enabled 戻す', () => {
    mount(seedRecord('hair_salon'))
    pick('yoga_studio')
    fireEvent.click(screen.getByRole('button', { name: '業種の標準に戻す' }))
    const no = screen.getByRole('button', { name: 'やめる' })
    const yes = screen.getByRole('button', { name: '戻す' })
    yes.focus()
    fireEvent.keyDown(yes, { key: 'Tab' })
    expect(document.activeElement).toBe(no)
    fireEvent.keyDown(no, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(yes)
  })

  it('canEdit=false disables the select and the button; nothing opens or changes', () => {
    const h = mount(seedRecord('hair_salon'), { canEdit: false })
    expect(select().disabled).toBe(true)
    const b = screen.getByRole('button', { name: '業種の標準に戻す' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    fireEvent.click(b)
    expect(dialog()).toBeNull()
    expect(h.changes).toEqual([])
  })
})

describe('R285 — editing withdrawn while the reset dialog is open', () => {
  // The D8 fixture: hair_salon with 物販 flipped off its default — the current type's diff has exactly one flip.
  const start = with_(seedRecord('hair_salon'), 'shop', !seedRecord('hair_salon').switches.shop.on)
  /** Same tree re-rendered with a new canEdit: the room owns the draft, the dialog state survives the re-render. */
  function open(canEdit: boolean) {
    const calls = { change: 0, keys: 0, toast: 0 }
    function Room({ edit }: { edit: boolean }) {
      const [draft, setDraft] = useState(start)
      return (
        <StorePageType
          draft={draft}
          saved={start}
          canEdit={edit}
          onChange={(n) => { calls.change++; setDraft(n) }}
          onResetKeys={() => { calls.keys++ }}
          onToast={() => { calls.toast++ }}
        />
      )
    }
    const r = render(<Room edit />)
    fireEvent.click(screen.getByRole('button', { name: '業種の標準に戻す' }))
    expect(resetDiff(start).flips).toHaveLength(1)
    expect(lines()).toEqual(expectedLines(start))
    if (!canEdit) r.rerender(<Room edit={false} />)
    return { calls, yes: () => screen.getByRole('button', { name: '戻す' }) as HTMLButtonElement }
  }

  it('(a) canEdit turns false while open → 戻す is disabled', () => {
    const h = open(false)
    expect(dialog()).not.toBeNull()
    expect(h.yes().disabled).toBe(true)
  })

  it('(b) a click on 戻す then calls none of onChange / onResetKeys / onToast; the dialog stays as it is', () => {
    const h = open(false)
    fireEvent.click(h.yes())
    expect(h.calls).toEqual({ change: 0, keys: 0, toast: 0 })
    expect(dialog()).not.toBeNull()
    expect(lines()).toEqual(expectedLines(start))
  })

  it('(c) control: with canEdit still true the same click calls all three', () => {
    const h = open(true)
    expect(h.yes().disabled).toBe(false)
    fireEvent.click(h.yes())
    expect(h.calls).toEqual({ change: 1, keys: 1, toast: 1 })
    expect(dialog()).toBeNull()
  })
})
