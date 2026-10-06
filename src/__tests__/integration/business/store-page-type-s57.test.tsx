/**
 * @jest-environment jsdom
 */
// S57 P5b — R182 (a pick keeps the reset keys) · R183 (a pick opens no dialog; the outline button does) · the attack's
// F3 mutants (M8 keeps rows, M10 merge, M3 outline button keeps keys) · NIT 3 (labels typed, no prototype keys) ·
// F4 (model.ts's run-time import graph reaches no fixtures module).
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StorePageType, type ResetKeysUpdate } from '@/app/[locale]/(business)/business/settings/StorePageType'
import { REG } from '@/business/lib/store-page/copy'
import { TYPE_LABEL } from '@/business/lib/store-page/type-labels'
import {
  BUSINESS_TYPE_KEYS, applyReset, resetDiff, seedRecord, stampSave,
  type BusinessTypeKey, type CapKey, type CapRecord,
} from '@/business/lib/store-page/model'

afterEach(cleanup)

const typed = (rec: CapRecord, t: BusinessTypeKey): CapRecord => ({ ...rec, business_type: t })
const with_ = (rec: CapRecord, key: CapKey, on: boolean, source: 'TYPE_DEFAULT' | 'OWNER'): CapRecord => ({
  ...rec, switches: { ...rec.switches, [key]: { on, source } },
})

function mount(start: CapRecord, keys: readonly CapKey[] = []) {
  let current = start
  let resetKeys: readonly CapKey[] = keys
  const log: string[] = []
  function Harness() {
    const [draft, setDraft] = useState(start)
    const [rk, setRk] = useState<readonly CapKey[]>(keys)
    current = draft
    resetKeys = rk
    return (
      <div className="page pg-settings">
        <StorePageType draft={draft} saved={start} canEdit
          onChange={(n) => { log.push('change'); setDraft(n) }}
          onResetKeys={(u: ResetKeysUpdate) => { log.push('keys'); setRk((p) => u(p)) }}
          onToast={() => {}} />
      </div>
    )
  }
  render(<Harness />)
  return { draft: () => current, resetKeys: () => resetKeys, log }
}
const select = () => screen.getByRole('combobox', { name: '業種' }) as HTMLSelectElement
const pick = (t: string) => { select().focus(); fireEvent.change(select(), { target: { value: t } }) }
const outline = () => fireEvent.click(screen.getByRole('button', { name: '業種の標準に戻す' }))
const confirm = () => fireEvent.click(screen.getByRole('button', { name: '戻す' }))
const cancel = () => fireEvent.click(screen.getByRole('button', { name: 'やめる' }))
const lines = () => Array.from(screen.getByRole('dialog').querySelectorAll('.sp-type-diff > div')).map((d) =>
  Array.from(d.querySelectorAll('span')).map((s) => s.textContent))
const ja = (k: CapKey) => REG.find((r) => r.key === k)?.ja

describe('R182 — the reset keys live from one save to the next', () => {
  it('A1: A -> B -> A after 戻す — on save every flipped key is still TYPE_DEFAULT', () => {
    const saved = seedRecord('hair_salon')
    const h = mount(saved)
    pick('yoga_studio')
    outline()
    confirm()
    const flipped = h.resetKeys()
    expect(flipped.length).toBeGreaterThan(0)
    pick('hair_salon')
    pick('yoga_studio')
    const draft = h.draft()
    expect(draft).toEqual(applyReset(typed(saved, 'yoga_studio')))
    const out = stampSave(saved, draft, h.resetKeys(), new Date('2026-10-03T00:00:00Z'), 'staff-1')
    expect(flipped.filter((k) => out.switches[k].source === 'OWNER')).toEqual([])
    expect(flipped.filter((k) => out.switches[k].source === 'TYPE_DEFAULT')).toEqual([...flipped])
  })

  it('M10: 戻す through the outline button after an earlier 戻す MERGES the keys, never replaces them', () => {
    const h = mount(seedRecord('hair_salon'))
    pick('yoga_studio'); outline(); confirm()
    const first = [...h.resetKeys()]
    const secondFlips = resetDiff(typed(h.draft(), 'dental_clinic')).flips.map((f) => f.key)
    expect(first.some((k) => !secondFlips.includes(k))).toBe(true) // non-vacuous: a replace would lose a key
    pick('dental_clinic'); outline(); confirm()
    const merged = h.resetKeys()
    for (const k of [...first, ...secondFlips]) expect(merged).toContain(k)
    expect(new Set(merged).size).toBe(merged.length)
  })

  it('M10 (preset keys): an outline 戻す keeps the keys the room already held', () => {
    const start = with_(seedRecord('hair_salon'), 'shop', !seedRecord('hair_salon').switches.shop.on, 'TYPE_DEFAULT')
    const h = mount(start, ['packs'])
    outline(); confirm()
    expect(h.resetKeys()).toEqual(['packs', 'shop'])
  })

  it('M3: the outline button alone never changes the reset keys before 戻す is pressed', () => {
    const h = mount(with_(seedRecord('hair_salon'), 'shop', !seedRecord('hair_salon').switches.shop.on, 'TYPE_DEFAULT'), ['packs'])
    outline()
    expect(screen.queryByRole('dialog')).not.toBeNull()
    expect(h.resetKeys()).toEqual(['packs'])
    expect(h.log).toEqual([])
    cancel()
    expect(h.resetKeys()).toEqual(['packs'])
    expect(h.log).toEqual([])
  })
})

describe('R183 — a change on the select opens no dialog', () => {
  it('one change: the type is set, no dialog', () => {
    const h = mount(seedRecord('hair_salon'))
    pick('yoga_studio')
    expect(h.draft().business_type).toBe('yoga_studio')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ten changes in a row open none', () => {
    const h = mount(seedRecord('hair_salon'))
    const steps = BUSINESS_TYPE_KEYS.slice(0, 10)
    expect(steps).toHaveLength(10)
    for (const t of steps) {
      pick(t)
      expect(screen.queryByRole('dialog')).toBeNull()
    }
    expect(h.draft().business_type).toBe(steps[9])
    expect(h.log).toEqual(Array(10).fill('change'))
  })
})

describe('M8 — the dialog lists an OWNER key under the keeps rows', () => {
  it('pick, then the outline button: every OWNER key the diff keeps has its 変更なし row', () => {
    const base = seedRecord('hair_salon')
    const start = with_(base, 'posts', !base.switches.posts.on, 'OWNER')
    mount(start)
    pick('yoga_studio')
    outline()
    const keeps = resetDiff(typed(start, 'yoga_studio')).keeps
    expect(keeps).toContain('posts')
    const keepLines = lines().filter((l) => l[1] === '変更なし（お店で設定済み）')
    expect(keepLines).toEqual(keeps.map((k) => [ja(k), '変更なし（お店で設定済み）']))
  })
})

describe('NIT 3 — TYPE_LABEL', () => {
  it('every one of the 26 keys has exactly one label; no prototype keys', () => {
    expect(BUSINESS_TYPE_KEYS).toHaveLength(26)
    expect(Object.keys(TYPE_LABEL).sort()).toEqual([...BUSINESS_TYPE_KEYS].sort())
    for (const k of BUSINESS_TYPE_KEYS) {
      expect(typeof TYPE_LABEL[k]).toBe('string')
      expect(TYPE_LABEL[k].length).toBeGreaterThan(0)
    }
    const loose = TYPE_LABEL as unknown as Record<string, unknown>
    expect(loose['constructor']).toBeUndefined()
    expect(loose['toString']).toBeUndefined()
    expect(Object.isFrozen(TYPE_LABEL)).toBe(true)
  })
})

describe('F4 — the graph pin', () => {
  // Static VALUE imports only (`import type` / `export type` skipped). Patterns are built so that no quoted
  // module specifier literal appears in this file (business-isolation.test.ts reads one as an import).
  const SRC = resolve(__dirname, '../../..')
  const Q = `['"]`
  const FROM = new RegExp('^\\s*(?:import|export)\\s+(?!type\\b)[^;\'"()=]*?\\bfrom\\s*' + Q + '([^\'"]+)' + Q, 'gm')
  const BARE = new RegExp('^\\s*import\\s*' + Q + '([^\'"]+)' + Q, 'gm')
  const FIX = ['fix', 'tures'].join('')
  const resolveSpec = (from: string, spec: string): string | null => {
    let base: string
    if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
    else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
    else return null // a package
    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const f = base + ext
      if (existsSync(f) && /\.tsx?$/.test(f)) return f
    }
    throw new Error('unresolved ' + spec + ' in ' + from)
  }
  const walk = (entry: string): string[] => {
    const seen = new Set<string>([entry])
    const todo = [entry]
    while (todo.length) {
      const f = todo.pop()!
      const text = readFileSync(f, 'utf8')
      for (const re of [FROM, BARE]) {
        for (const m of text.matchAll(re)) {
          const r = resolveSpec(f, m[1])
          if (r && !seen.has(r)) { seen.add(r); todo.push(r) }
        }
      }
    }
    return [...seen]
  }

  it('model.ts reaches copy.ts and no file whose name contains the fixtures word', () => {
    const graph = walk(join(SRC, 'business/lib/store-page/model.ts'))
    expect(graph.some((f) => f.endsWith('/store-page/copy.ts'))).toBe(true)
    expect(graph.filter((f) => f.split('/').pop()!.includes(FIX))).toEqual([])
  })

  it('the walker is live: type-labels.ts does reach the fixtures module', () => {
    const graph = walk(join(SRC, 'business/lib/store-page/type-labels.ts'))
    expect(graph.filter((f) => f.split('/').pop()!.includes(FIX)).length).toBeGreaterThan(0)
  })
})

// S58 P5B-R2 (R197) — the reset button is clicked with NO prior .focus(): jsdom's fireEvent.click, like Safari,
// does not focus a button, so the handler itself must focus it before the dialog takes its opener.
import { waitFor } from '@testing-library/react'

describe('R197 — the reset button focuses itself before it opens the dialog', () => {
  const resetButton = () => screen.getByRole('button', { name: '業種の標準に戻す' })

  it('focus on the select, click the button, やめる: the focus is back on the button', async () => {
    mount(seedRecord('hair_salon'))
    select().focus()
    expect(document.activeElement).toBe(select())
    outline()
    expect(screen.queryByRole('dialog')).not.toBeNull()
    cancel()
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(resetButton()))
  })

  it('focus on the select, click the button, Esc: the focus is back on the button', async () => {
    mount(seedRecord('hair_salon'))
    select().focus()
    expect(document.activeElement).toBe(select())
    outline()
    expect(screen.queryByRole('dialog')).not.toBeNull()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(resetButton()))
  })

  it('nothing focused, a type picked, click the button, 戻す: the focus is on the button', async () => {
    const h = mount(seedRecord('hair_salon'))
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)
    fireEvent.change(select(), { target: { value: 'yoga_studio' } })
    expect(document.activeElement).toBe(document.body)
    outline()
    expect(screen.queryByRole('dialog')).not.toBeNull()
    confirm()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.draft().business_type).toBe('yoga_studio')
    await waitFor(() => expect(document.activeElement).toBe(resetButton()))
  })
})
