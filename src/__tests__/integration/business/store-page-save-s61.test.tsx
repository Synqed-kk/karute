/**
 * @jest-environment jsdom
 *
 * S61 P7B-2 — the room's split save, from the press to the lines (DECISIONS-S61 R218–R221). Harness copied from
 * store-page-room-s60.test.tsx lines 7-87, verbatim; door ON = the `saveCardColor` prop, as that file does.
 */
const mockCore: { reaches: number; noStores: boolean; settings: Record<string, unknown> } = { reaches: 0, noStores: false, settings: {} }
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))
jest.mock('@/business/lib/admission', () => ({ requireBusinessAdmission: jest.fn() }))
jest.mock('@/business/lib/practice-door/core-reach', () => {
  const { practiceTenant } = jest.requireActual('@/business/lib/practice-door/switch')
  class PracticeTenantMismatch extends Error {
    businessId: string
    constructor(businessId: string) { super(`practice switch refused business ${businessId}`); this.name = 'PracticeTenantMismatch'; this.businessId = businessId }
  }
  const guard = (admitted: { businessId: string }) => {
    const tenant = practiceTenant()
    if (tenant === null) throw new Error('practice door called with the switch unset')
    if (admitted.businessId !== tenant) throw new PracticeTenantMismatch(admitted.businessId)
  }
  return {
    PracticeTenantMismatch,
    orgSettingsWriterFor: () => { throw new Error('no writes in this suite') },
    // S50 P3 — the org settings and the store list are the test's to set; every core reach is counted.
    clientFor: (admitted: { businessId: string }) => {
      mockCore.reaches++
      guard(admitted)
      const r = jest.requireActual('./practice-door-recorded').recordedReads()
      return {
        ...r,
        storesList: async () => (mockCore.noStores ? { stores: [] } : r.storesList()),
        orgSettingsGet: async () => {
          const got = await r.orgSettingsGet()
          return got && { ...got, settings: { ...got.settings, ...mockCore.settings } }
        },
      }
    },
    storeDaysWriterFor: () => { throw new Error('no writes in this suite') },
    auditWriterFor: () => { throw new Error('no writes in this suite') },
  }
})

import { render, fireEvent, act } from '@testing-library/react'
import type { ReactElement } from 'react'
import { requireBusinessAdmission } from '@/business/lib/admission'
import SettingsPage from '@/app/[locale]/(business)/business/settings/page'
import { LOGIN, STORE, TENANT } from './practice-door-recorded'

const admission = requireBusinessAdmission as jest.MockedFunction<typeof requireBusinessAdmission>
const realFetch = global.fetch

/** Stub a prototype property and return its exact undo (card-look-source-line.test.tsx's helper): an OWN
 *  descriptor the prototype had is put back; an absent one is DELETED, never re-defined. */
const stubProto = (proto: object, key: string, desc: PropertyDescriptor) => {
  const own = Object.getOwnPropertyDescriptor(proto, key)
  Object.defineProperty(proto, key, { configurable: true, ...desc })
  return () => { if (own) Object.defineProperty(proto, key, own); else delete (proto as Record<string, unknown>)[key] }
}
const SCROLL_INTO_VIEW_BEFORE = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
let undoScrollIntoView = () => {}
beforeAll(() => {
  const util = jest.requireActual('node:util')
  const web = jest.requireActual('node:stream/web')
  Object.assign(global, { TextEncoder: util.TextEncoder, TextDecoder: util.TextDecoder, ReadableStream: web.ReadableStream, WritableStream: web.WritableStream, TransformStream: web.TransformStream })
  Object.defineProperty(window, 'matchMedia', { writable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) })
  ;(global as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  window.scrollTo = () => {}
  undoScrollIntoView = stubProto(Element.prototype, 'scrollIntoView', { value: () => {}, writable: true })
})
// the prototype holds exactly what it held before this file (the own descriptor put back, or the stub deleted)
afterAll(() => {
  undoScrollIntoView()
  expect(Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')).toEqual(SCROLL_INTO_VIEW_BEFORE)
})
beforeEach(() => {
  Object.assign(mockCore, { reaches: 0, noStores: false, settings: {} })
  process.env.BUSINESS_PRACTICE_TENANT = TENANT
  admission.mockResolvedValue({ userId: LOGIN.owner, email: null, displayName: null, businessId: TENANT })
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => null })) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => {
  global.fetch = realFetch
  jest.restoreAllMocks()
})

// ---- S61 P7B-2 — the room's split save (R218–R221)
import { SettingsScreen } from '@/app/[locale]/(business)/business/settings/SettingsScreen'
import { sourceLine } from '@/app/[locale]/(business)/business/settings/StorePageRows'
import { CAP_KEYS, recordHash, type CapKey, type CapRecord } from '@/business/lib/store-page/model'
import { SAVE_FAIL, UNDO } from '@/business/lib/store-page/copy'

type ScreenProps = Parameters<typeof SettingsScreen>[0]
const SP = 'reserve-store-page'
const CAPS = '/api/business/store-capabilities'
const COLOUR = '/api/business/card-color'
const propsFor = async (store: string): Promise<ScreenProps> =>
  ((await SettingsPage({ params: Promise.resolve({ locale: 'ja' }), searchParams: Promise.resolve({ store, section: SP }) })) as ReactElement<ScreenProps>).props
const payloadOf = (p: ScreenProps) => p.sections.find((s) => s.id === SP)!.storePage!
const count = () => document.querySelector('.st-save-count')?.textContent
const saveBtn = () => document.querySelector('.st-save') as HTMLButtonElement
const undoBtn = () => [...document.querySelectorAll('button')].find((b) => b.textContent === UNDO.button) as HTMLButtonElement
const toastHost = () => document.querySelector('.pg-settings > .st-toast') as HTMLElement
const alerts = () => [...document.querySelectorAll('.st-act-error[role="alert"]')].map((el) => el.textContent)
const sw = (key: CapKey) => document.querySelector(`.spr-row[data-key="${key}"] [role="switch"]`) as HTMLElement
const src = (key: CapKey) => document.querySelector(`.spr-row[data-key="${key}"] .spr-src`)?.textContent
const flip = async (key: CapKey) => {
  await act(async () => { fireEvent.click(sw(key)) })
  const commit = document.querySelector('.spr-commit') // an OFF with a count asks first (spec D27)
  if (commit) await act(async () => { fireEvent.click(commit) })
}
const pickOther = async () => {
  const other = [...document.querySelectorAll('.cl-swatch')].find((el) => el.getAttribute('aria-checked') !== 'true') as HTMLElement
  await act(async () => { fireEvent.click(other) })
}
const flipped = (rec: CapRecord, key: CapKey): CapRecord =>
  ({ ...rec, switches: { ...rec.switches, [key]: { ...rec.switches[key], on: !rec.switches[key].on } } })
const K: CapKey = 'posts'
const K2: CapKey = CAP_KEYS.find((k) => k !== K)!

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> }
type Answer = { status: number; body: unknown }
/** The room tests' seam (global.fetch = jest.fn): each URL answered by its own function; every call recorded. */
const stub = (caps: (body: Record<string, unknown>) => Answer | Promise<Answer>, colour: (body: Record<string, unknown>) => Answer = (b) => ({ status: 200, body: { ok: true, color: b.color ?? null } })) => {
  const calls: Call[] = []
  global.fetch = jest.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>
    calls.push({ url: String(url), headers: init.headers, body })
    const a = String(url) === CAPS ? await caps(body) : colour(body)
    return { ok: a.status === 200, status: a.status, json: async () => a.body }
  }) as unknown as typeof fetch
  return calls
}
const echo = (b: Record<string, unknown>): Answer => ({ status: 200, body: { ok: true, record: b.record } })
const mount = async (p: ScreenProps) => {
  render(<SettingsScreen {...p} saveCardColor={{ businessId: TENANT, canSave: true }} />)
  await act(async () => {})
}
const press = async () => {
  await act(async () => { fireEvent.click(saveBtn()) })
  await act(async () => {})
}

describe('S61 P7B-2 — the split save', () => {
  it('s1 a flipped switch + 保存する → ONE capabilities PUT (header, four keys, the payload based_on, record = the draft), NO colour PUT', async () => {
    const calls = stub(echo)
    const p = await propsFor(STORE.tokyo)
    await mount(p)
    await flip(K)
    await press()
    expect(calls.map((c) => c.url)).toEqual([CAPS])
    expect(calls[0].headers['x-expected-business']).toBe(TENANT)
    expect(Object.keys(calls[0].body).sort()).toEqual(['based_on', 'record', 'reset_keys', 'storeId'])
    expect(calls[0].body.based_on).toBe(payloadOf(p).basedOn)
    expect(calls[0].body.storeId).toBe(payloadOf(p).storeId)
    expect(calls[0].body.record).toEqual(flipped(payloadOf(p).saved, K))
    expect(calls[0].body.reset_keys).toEqual([])
  })

  it('s2 colour only → one colour PUT, no capabilities PUT', async () => {
    const calls = stub(echo)
    await mount(await propsFor(STORE.tokyo))
    await pickOther()
    await press()
    expect(calls.map((c) => c.url)).toEqual([COLOUR])
    expect(count()).toMatch(/^✓ 保存しました /)
  })

  it('s2b under the all-stores lens (no storePage): today\'s behaviour — one colour PUT, the same stamp', async () => {
    const calls = stub(echo)
    mockCore.noStores = true // the lens with no store, as store-page-room-s59.test.tsx:141 builds it
    const p = await propsFor('all-stores')
    expect(p.sections.find((s) => s.id === SP)!.storePage).toBeUndefined()
    await mount(p)
    await pickOther()
    await press()
    expect(calls.map((c) => c.url)).toEqual([COLOUR])
    expect(count()).toMatch(/^✓ 保存しました /)
  })

  it('s3 both changed → both PUTs; both 200 → 0 changes, the stamp', async () => {
    const calls = stub(echo)
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await pickOther()
    expect(count()).toBe('変更した設定 2件')
    await press()
    expect(calls.map((c) => c.url).sort()).toEqual([COLOUR, CAPS].sort())
    expect(count()).toMatch(/^✓ 保存しました /)
    expect(alerts()).toEqual([])
  })

  it('s4 a 200 whose record differs from the draft → saved, the values and the source lines follow the RESPONSE; the next body carries its hash and reset_keys []', async () => {
    let answer: CapRecord | null = null
    const calls = stub((b) => {
      if (answer === null) {
        const sent = b.record as CapRecord
        const o = flipped(sent, K2)
        // S75 fix 3 (R-E): core stamps the key it moved OWNER (a TYPE_DEFAULT key off its standard is never a saved state)
        const other = { ...o, switches: { ...o.switches, [K2]: { ...o.switches[K2], source: 'OWNER' as const, changed_at: '2026-10-03T01:02:03.000Z' } } }
        answer = { ...other, switches: { ...other.switches, [K]: { ...other.switches[K], source: 'OWNER', changed_at: '2026-10-03T01:02:03.000Z' } } }
        return { status: 200, body: { ok: true, record: answer } }
      }
      return echo(b)
    })
    const p = await propsFor(STORE.tokyo)
    await mount(p)
    const k2Before = sw(K2).getAttribute('aria-checked')
    await flip(K)
    await press()
    expect(calls).toHaveLength(1)
    const got = answer as unknown as CapRecord
    // S75 fix 2 (R-A): K2 — core answered the other way; the saved record is the only truth, the room's value follows it
    expect(count()).toMatch(/^✓ 保存しました /)
    expect(sw(K2).getAttribute('aria-checked')).not.toBe(k2Before)
    expect(src(K)).toBe(sourceLine(got, K))
    expect(src(K)).not.toBe(sourceLine(payloadOf(p).saved, K))
    await press()
    expect(calls).toHaveLength(1) // nothing left to send
    await flip(K)
    await press()
    expect(calls).toHaveLength(2)
    expect(calls[1].body.based_on).toBe(recordHash(got))
    expect(calls[1].body.based_on).not.toBe(payloadOf(p).basedOn)
    expect(calls[1].body.reset_keys).toEqual([])
  })

  it('s5 409 stale → X4-alt in a role="alert" line, the draft kept, the count unchanged, no stamp; a second press sends the SAME based_on', async () => {
    const calls = stub(() => ({ status: 409, body: { ok: false, reason: 'stale' } }))
    const p = await propsFor(STORE.tokyo)
    await mount(p)
    await flip(K)
    const on = sw(K).getAttribute('aria-checked')
    await press()
    expect(alerts()).toEqual([SAVE_FAIL.stale])
    expect(sw(K).getAttribute('aria-checked')).toBe(on)
    expect(count()).toBe('変更した設定 1件')
    expect(document.querySelector('.st-save-card')?.textContent ?? '').not.toContain('✓ 保存しました')
    await press()
    expect(calls).toHaveLength(2)
    expect(calls[1].body.based_on).toBe(calls[0].body.based_on)
    expect(calls[1].body.based_on).toBe(payloadOf(p).basedOn)
    expect(calls[1].body.record).toEqual(calls[0].body.record)
  })

  it('s6 a save in flight: a second press sends nothing; 元に戻す does nothing; after the answer both work', async () => {
    let release: (a: Answer) => void = () => {}
    let held = true
    const calls = stub((b) => (held ? new Promise<Answer>((res) => { release = res }) : echo(b)))
    const p6 = await propsFor(STORE.tokyo)
    await mount(p6)
    await flip(K)
    const on = sw(K).getAttribute('aria-checked')
    await press()
    await press()
    expect(calls).toHaveLength(1)
    await act(async () => { fireEvent.click(undoBtn()) })
    expect(toastHost().textContent).toBe('')
    expect(sw(K).getAttribute('aria-checked')).toBe(on)
    held = false
    // S75 fix 3 (R-E): core answers with its own stamp (K OWNER), not the draft echoed with K still TYPE_DEFAULT
    const b0 = calls[0].body
    await act(async () => { release({ status: 200, body: { ok: true, record: stampSave(payloadOf(p6).saved, b0.record as CapRecord, b0.reset_keys as CapKey[], new Date('2026-10-06T12:00:00.000Z'), 'staff-1') } }) })
    await act(async () => {})
    expect(count()).toMatch(/^✓ 保存しました /)
    await flip(K2)
    await press()
    expect(calls).toHaveLength(2)
    await flip(K)
    await act(async () => { fireEvent.click(undoBtn()) })
    expect(toastHost().textContent).toBe(UNDO.toast)
    expect(sw(K).getAttribute('aria-checked')).toBe(on)
  })

  it('s7 switches-only success while the colour was edited DURING the flight: the colour stays an unsaved change, no colour PUT ever', async () => {
    let release: (a: Answer) => void = () => {}
    const calls = stub(() => new Promise<Answer>((res) => { release = res }))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await press()
    await pickOther()
    await act(async () => { release(echo(calls[0].body)) })
    await act(async () => {})
    expect(calls.map((c) => c.url)).toEqual([CAPS])
    expect(count()).toBe('変更した設定 1件')
  })

  it('s7b colour refused (403) + switches 200 in one press: the colour stays an unsaved change with its own line, the switch is saved', async () => {
    const calls = stub(echo, () => ({ status: 403, body: { ok: false, reason: 'forbidden' } }))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await pickOther()
    await press()
    expect(calls).toHaveLength(2)
    expect(count()).toBe('変更した設定 1件')
    expect(alerts()).toEqual([COLOUR_FORBIDDEN]) // S61 P7B-R1 (the lead): the colour's forbidden line, exactly
  })
})

// ---- S61 P7B-3 — the edges, the owed tests (R182, R209, R219, R220, S4, LOG 14)
// The six lines below are script-copied byte for byte from LANE/s49-2026-10-01/COPY-S49.md by id (R220).
const X1 = '設定を変更できる権限がないため保存できず、お客様のアプリに出る機能はこれまでのままです。'
const X2 = 'ここからはこの事業の設定を保存できないため、お客様のアプリに出る機能はこれまでのままです。'
const X3 = 'いまは保存できないため、時間をおいてもう一度保存してください（お客様のアプリに出る機能はこれまでのままです）。'
const X4ALT = 'この店舗のお店ページの設定が、このページを開いたあとにほかの画面や端末で保存されたため、保存できませんでした。変更した内容はこの画面に残っていますが、再読み込みすると消えます。最新の設定を確認してから、もう一度変更してください。'
const L9 = 'カードの色は保存しましたが、業種と機能の設定は保存できませんでした。時間をおいてもう一度保存してください（お客様のアプリに出る機能はこれまでのままです）。'
const L10 = '業種と機能の設定は保存しましたが、カードの色は保存できませんでした。時間をおいてもう一度保存してください（お客様のアプリのカードはこれまでの色のままです）。'
// S61 P7B-R1 — script-copied byte for byte from SettingsScreen.tsx's CARD_SAVE_FAIL.forbidden (never retyped).
const COLOUR_FORBIDDEN = '設定を変更できる権限がないため保存できず、お客様のアプリのカードはこれまでの色のままです。'
import { resetDiff } from '@/business/lib/store-page/model'
const typeSelect = () => document.querySelector('.sp-type-select') as HTMLSelectElement
const typePick = async () => {
  const other = [...typeSelect().options].find((o) => o.value !== typeSelect().value)!.value
  await act(async () => { fireEvent.change(typeSelect(), { target: { value: other } }) })
}
const typeReset = async () => {
  await act(async () => { fireEvent.click(document.querySelector('.sp-type-reset') as HTMLElement) })
  await act(async () => { fireEvent.click(document.querySelector('.sp-type-dlg .btn.primary') as HTMLElement) })
}
const undo = async () => { await act(async () => { fireEvent.click(undoBtn()) }) }
/** The reset keys 戻す adds when K and K2 were flipped from the payload (the dialog's own diff, model.ts resetDiff). */
const resetOf = (p: ScreenProps) => resetDiff(flipped(flipped(payloadOf(p).saved, K), K2)).flips.map((f) => f.key)
const sorted = (v: unknown) => [...(v as string[])].sort()
const refuse = (status: number, reason: string) => (): Answer => ({ status, body: { ok: false, reason } })

describe('S61 P7B-3 — e1 each refusal of the switches → its line, exactly (R220)', () => {
  const cases: [string, () => Answer | Promise<Answer>, string][] = [
    ['403 forbidden', refuse(403, 'forbidden'), X1],
    ['409 tenant', refuse(409, 'tenant'), X2],
    ['503 core', refuse(503, 'core'), X3],
    ['400 invalid', refuse(400, 'invalid'), X3],
    ['501 disconnected', refuse(501, 'disconnected'), X3],
    ['a network failure', () => { throw new TypeError('Failed to fetch') }, X3],
  ]
  it.each(cases)('e1 %s', async (_name, answer, line) => {
    stub(answer)
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await press()
    expect(alerts()).toEqual([line])
    expect(count()).toBe('変更した設定 1件')
  })
})

describe('S61 P7B-3 — e2 one press, two answers: each line says only its own truth (R220, S5)', () => {
  it('e2a colour 200 + switches 503 → L9 alone; the colour counted saved, the switch still unsaved', async () => {
    stub(refuse(503, 'core'))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await pickOther()
    expect(count()).toBe('変更した設定 2件')
    await press()
    expect(alerts()).toEqual([L9])
    expect(count()).toBe('変更した設定 1件')
  })
  it('e2b switches 200 + colour 503 → L10 alone; the count = 1 (the colour)', async () => {
    stub(echo, refuse(503, 'core'))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await pickOther()
    await press()
    expect(alerts()).toEqual([L10])
    expect(count()).toBe('変更した設定 1件')
  })
  it('e2c colour 200 + switches 409 stale → X4-alt alone', async () => {
    stub(refuse(409, 'stale'))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await pickOther()
    await press()
    expect(alerts()).toEqual([X4ALT])
    expect(count()).toBe('変更した設定 1件')
  })
})

describe('S61 P7B-3 — e3 a newer edit of its own half clears the switches\' line (C1, G7) · 元に戻す clears it (C2, R209)', () => {
  it('e3a a switch flip removes the line', async () => {
    stub(refuse(503, 'core'))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await press()
    expect(alerts()).toEqual([X3])
    await flip(K2)
    expect(alerts()).toEqual([])
  })
  it('e3b a type pick removes the line', async () => {
    stub(refuse(403, 'forbidden'))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await press()
    expect(alerts()).toEqual([X1])
    await typePick()
    expect(alerts()).toEqual([])
  })
  it('e3c 元に戻す removes the line', async () => {
    stub(refuse(409, 'stale'))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await press()
    expect(alerts()).toEqual([X4ALT])
    await undo()
    expect(alerts()).toEqual([])
    expect(toastHost().textContent).toBe(UNDO.toast)
  })
})

describe('S61 P7B-3 — e4 a reader who may not save (C3, S4)', () => {
  it('e4 no 保存する, locked blocks, NO request of either kind on any interaction', async () => {
    const calls = stub(echo)
    const p = await propsFor(STORE.tokyo)
    render(<SettingsScreen {...p} saveCardColor={{ businessId: TENANT, canSave: false }} />)
    await act(async () => {})
    expect(document.querySelector('.st-save')).toBeNull()
    expect(undoBtn()).toBeUndefined()
    const on = sw(K).getAttribute('aria-checked')
    await act(async () => { fireEvent.click(sw(K)) })
    expect(sw(K).getAttribute('aria-checked')).toBe(on)
    expect(typeSelect().disabled).toBe(true)
    expect((document.querySelector('.sp-type-reset') as HTMLButtonElement).disabled).toBe(true)
    const type = typeSelect().value
    await typePick()
    expect(typeSelect().value).toBe(type)
    await pickOther()
    expect(calls).toEqual([])
  })
})

describe('S61 P7B-3 — e5 THE THREE OWED (DECISIONS-S60, attack F4)', () => {
  it('e5a after 戻す then a hand flip of one of its keys, the body\'s reset_keys lacks exactly that key', async () => {
    const calls = stub(echo)
    const p = await propsFor(STORE.tokyo)
    await mount(p)
    const R = resetOf(p)
    expect(R).toEqual(expect.arrayContaining([K, K2]))
    await flip(K)
    await flip(K2)
    await typeReset()
    await flip(K)
    await press()
    expect(calls).toHaveLength(1)
    expect(sorted(calls[0].body.reset_keys)).toEqual(R.filter((k) => k !== K).sort())
  })
  it('e5b a type pick removes no key from the next body', async () => {
    const calls = stub(echo)
    const p = await propsFor(STORE.tokyo)
    await mount(p)
    await flip(K)
    await flip(K2)
    await typeReset()
    await typePick()
    await press()
    expect(calls).toHaveLength(1)
    expect(sorted(calls[0].body.reset_keys)).toEqual(resetOf(p).sort())
  })
  it('e5c after 元に戻す the next body carries reset_keys []', async () => {
    const calls = stub(echo)
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await flip(K2)
    await typeReset()
    // 戻す put K and K2 back to the type default (= saved here), so the section is clean and 元に戻す has nothing to
    // undo (its own guard, changed === 0); a third key, flipped by hand, makes it pressable without touching the keys.
    await flip(CAP_KEYS.find((k) => k !== K && k !== K2)!)
    await undo()
    expect(toastHost().textContent).toBe(UNDO.toast)
    await flip(K)
    await press()
    expect(calls).toHaveLength(1)
    expect(calls[0].body.reset_keys).toEqual([])
  })
})

describe('S61 P7B-3 — e6 R219\'s identity rule for the reset keys', () => {
  it('e6a a 戻す DURING a switches save in flight → after the 200 the reset keys are NOT emptied', async () => {
    let release: (a: Answer) => void = () => {}
    let held = true
    const calls = stub((b) => (held ? new Promise<Answer>((res) => { release = res }) : echo(b)))
    const p = await propsFor(STORE.tokyo)
    await mount(p)
    await flip(K)
    await press()
    expect(calls[0].body.reset_keys).toEqual([])
    await flip(K2)
    await typeReset()
    held = false
    await act(async () => { release(echo(calls[0].body)) })
    await act(async () => {})
    await press()
    expect(calls).toHaveLength(2)
    expect(resetOf(p)).toEqual(expect.arrayContaining([K, K2]))
    expect(sorted(calls[1].body.reset_keys)).toEqual(resetOf(p).sort())
  })
  it('e6b after a 200 with no edit in flight the next body carries reset_keys []', async () => {
    const calls = stub(echo)
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await flip(K2)
    await typeReset()
    await flip(K)
    await press()
    expect(calls[0].body.reset_keys).toEqual(expect.arrayContaining([K2]))
    // the next edit is a key NOT in the list, so only the 200 itself can have emptied it (a hand flip of K2 would too)
    await flip(CAP_KEYS.find((k) => k !== K && k !== K2)!)
    await press()
    expect(calls).toHaveLength(2)
    expect(calls[1].body.reset_keys).toEqual([])
  })
})

describe('S61 P7B-3 — e7 a refusal empties nothing (R219, S7)', () => {
  it('e7 after a 503 the next body carries the same reset_keys and the same based_on', async () => {
    const calls = stub(refuse(503, 'core'))
    const p = await propsFor(STORE.tokyo)
    await mount(p)
    await flip(K)
    await flip(K2)
    await typeReset()
    await flip(K)
    await press()
    await press()
    expect(calls).toHaveLength(2)
    expect(calls[0].body.reset_keys).toEqual(expect.arrayContaining([K2]))
    expect(calls[1].body.reset_keys).toEqual(calls[0].body.reset_keys)
    expect(calls[1].body.based_on).toBe(calls[0].body.based_on)
    expect(calls[1].body.based_on).toBe(payloadOf(p).basedOn)
  })
})

describe('S61 P7B-3 — C4 (LOG 14) a locked .st-link states no press, in both rules', () => {
  it('both .st-link:active rules carry :not([aria-disabled="true"]); no bare one is left', () => {
    const fs = jest.requireActual('node:fs') as typeof import('node:fs')
    const path = jest.requireActual('node:path') as typeof import('node:path')
    const css = fs.readFileSync(path.join(process.cwd(), 'src/app/[locale]/(business)/business/settings/settings.css'), 'utf8')
    expect(css.split('.st-link:not([aria-disabled="true"]):active').length - 1).toBe(2)
    expect(css).not.toMatch(/\.st-link:active[,\s{]/)
    const reduce = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduce).toContain('.st-link:not([aria-disabled="true"]):active')
  })
})

// ---- S61 P7B-R1 — the fix round (R224, R225, attack F8, attack F1/F2)
import { readFileSync } from 'node:fs'
import { chipText, familyOf, type BusinessTypeKey } from '@/business/lib/store-page/model'
import { practiceSample } from '@/business/lib/store-page/practice-counts'
import { STORES } from '@/business/lib/reserve-card/store-page-sample'
/** Held answers, copied from L61/attack-p7b/attack-p7b-room-s61.test.tsx:168-181 (hold, okColour, okCaps). */
type Held = { url: string; body: Record<string, unknown>; resolve: (a: Answer) => void }
const hold = () => {
  const held: Held[] = []
  global.fetch = jest.fn((url: string, init: { body: string }) => new Promise((res) => {
    held.push({ url: String(url), body: JSON.parse(init.body), resolve: (a) => res({ ok: a.status === 200, status: a.status, json: async () => a.body }) })
  })) as unknown as typeof fetch
  return { held, caps: () => held.filter((h) => h.url === CAPS), colour: () => held.filter((h) => h.url === COLOUR) }
}
const okColour = async (h: Held) => { await act(async () => { h.resolve({ status: 200, body: { ok: true, color: h.body.color ?? null } }) }) }
const okCaps = async (h: Held) => { await act(async () => { h.resolve({ status: 200, body: { ok: true, record: h.body.record } }) }) }
const chips = () => CAP_KEYS.map((k) => document.querySelector(`.spr-row[data-key="${k}"] .spr-chip`)?.textContent ?? null)
const chipsFor = (rec: CapRecord, counts: Parameters<typeof chipText>[2]) => CAP_KEYS.map((k) => chipText(k, rec, counts))
/** The preview's store-page view: the second button of its view switch (ReserveCardLookSection.tsx:224-226; the same
 *  `.cl-preview .sp-seg button` selector as card-look-title.test.tsx:95, the click as card-look-store-view.test.tsx:37's
 *  openStore). The HOME view does not read the sample; only this view's StoreBody does (ReserveCardPreview.tsx:420-556). */
const openStoreView = async () => {
  const btn = document.querySelectorAll('.cl-preview .sp-seg button')[1] as HTMLButtonElement
  await act(async () => { fireEvent.click(btn) })
  expect(btn.getAttribute('aria-pressed')).toBe('true')
}
/** What only ONE sample draws in that view (store-page-sample.ts): La Estro's rank chip `rv.rank` (StoreBody's
 *  .salon-rankfloat, ReserveCardPreview.tsx:428-434; STUDIO FORCE's rank is ''), and STUDIO FORCE's `rv.emptyVisits`
 *  (MyRecord's visits tab with no visits; La Estro has five). Each sample's own marker is drawn, the other's is not. */
const drawn = (key: keyof typeof STORES) => {
  const body = document.querySelector('.cl-preview [data-store-body]')
  expect(body).not.toBeNull()
  const text = body?.textContent ?? ''
  expect([text.includes(STORES.laestro.rv.rank), text.includes(STORES.force.rv.emptyVisits)]).toEqual([key === 'laestro', key === 'force'])
}
const rail = async (id: string) => { await act(async () => { fireEvent.click(document.querySelector(`.st-rail-item[data-rail-id="${id}"]`) as HTMLElement) }) }

describe('S61 P7B-R1 — R224 the sample is the SAVED type\'s', () => {
  it('r1 a type of the other sample family: the pick alone and the flight keep the sample; the 200 moves the preview and the rows\' counts to the saved type\'s sample', async () => {
    let release: (a: Answer) => void = () => {}
    const calls = stub(() => new Promise<Answer>((res) => { release = res }))
    const p = await propsFor(STORE.tokyo)
    await mount(p)
    await openStoreView()
    const loaded = payloadOf(p)
    const gym = familyOf(loaded.saved.business_type) === 'GYM'
    const other = [...typeSelect().options].map((o) => o.value).find((v) => v !== '' && (familyOf(v) === 'GYM') !== gym) as BusinessTypeKey
    const before = practiceSample(loaded.saved.business_type)
    const after = practiceSample(other)
    expect(loaded.sampleKey).toBe(before.sampleKey)
    expect(after.sampleKey).not.toBe(before.sampleKey)
    await act(async () => { fireEvent.change(typeSelect(), { target: { value: other } }) })
    drawn(before.sampleKey)
    await press()
    expect(calls).toHaveLength(1)
    const sent = calls[0].body.record as CapRecord
    expect(sent.business_type).toBe(other)
    expect(chipsFor(sent, before.counts)).not.toEqual(chipsFor(sent, after.counts)) // the two samples print differently
    expect(chips()).toEqual(chipsFor(sent, before.counts))
    drawn(before.sampleKey)
    await act(async () => { release(echo(calls[0].body)) })
    await act(async () => {})
    expect(chips()).toEqual(chipsFor(sent, after.counts))
    drawn(after.sampleKey)
  })
})

describe('S61 P7B-R1 — R225 / attack F8 the lines a newer act withdraws', () => {
  it('r2 colour 200 + switches 503 → L9; then a colour pick → the switches\' own X3, not L9', async () => {
    stub(refuse(503, 'core'))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await pickOther()
    await press()
    expect(alerts()).toEqual([L9])
    await pickOther()
    expect(alerts()).toEqual([X3])
  })
  it('r3a L9, then a move to another section and back through the rail (openSection) → no line', async () => {
    stub(refuse(503, 'core'))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await pickOther()
    await press()
    expect(alerts()).toEqual([L9])
    const away = [...document.querySelectorAll('.st-rail-item')].map((b) => b.getAttribute('data-rail-id')).find((id) => id !== null && id !== SP)!
    await rail(away)
    await rail(SP)
    expect(alerts()).toEqual([])
  })
  it('r3b X3, then back to the list (backToList) and the section again → no line', async () => {
    stub(refuse(503, 'core'))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await press()
    expect(alerts()).toEqual([X3])
    await act(async () => { fireEvent.click(document.querySelector('.st-back') as HTMLElement) })
    await rail(SP)
    expect(alerts()).toEqual([])
  })
  it('r3c source pin: BOTH section moves reset the switches\' line (backToList\'s is masked behaviourally by openSection on the way back)', () => {
    const code = readFileSync('src/app/[locale]/(business)/business/settings/SettingsScreen.tsx', 'utf8')
    const body = (name: string) => code.slice(code.indexOf(`const ${name} = useCallback(`), code.indexOf('}, [', code.indexOf(`const ${name} = useCallback(`)))
    for (const name of ['openSection', 'backToList']) expect(body(name)).toContain("setSpPress({ cardOk: false, caps: 'unsent' })")
  })
})

describe('S61 P7B-R1 — attack F1/F2: the three mutants that survived', () => {
  it('r4 (X221a) both halves sent: after the FIRST answer a second press and the undo still do nothing; after the second both work', async () => {
    const h = hold()
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await pickOther()
    await press()
    expect(h.held).toHaveLength(2)
    await okCaps(h.caps()[0])
    await act(async () => {})
    await flip(K2)
    await press()
    expect(h.held).toHaveLength(2)
    await undo()
    expect(toastHost().textContent).toBe('')
    await okColour(h.colour()[0])
    await act(async () => {})
    await undo()
    expect(toastHost().textContent).toBe(UNDO.toast)
    await flip(K2)
    await press()
    expect(h.held).toHaveLength(3)
  })
  it("r5 (X222b) a 200 whose body is {ok:false, reason:'stale'} → X4-alt", async () => {
    stub(() => ({ status: 200, body: { ok: false, reason: 'stale' } }))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await press()
    expect(alerts()).toEqual([X4ALT])
  })
  it('r6 (X220c) an old L9 is gone the moment the next press is sent, before any answer', async () => {
    let n = 0
    const calls = stub(() => (++n === 1 ? refuse(503, 'core')() : new Promise<Answer>(() => {})))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await pickOther()
    await press()
    expect(alerts()).toEqual([L9])
    await press()
    expect(calls.filter((c) => c.url === CAPS)).toHaveLength(2)
    expect(alerts()).toEqual([])
  })
})

// S75 fix 2 (R-A, READ-FIX1-SONNET-S75 SF1) — a save under the R269 lock leaves no phantom change: after the 200 the room's
// values are the record core returned (the door's own stampSave answers here), so the count is 0 and a second press sends
// nothing. S75 fix 3 (R-E, READ-FIX2-SONNET-S75 SF1): a pick back then shows the TABLE's standard (ON) under the true label
// 「業種の標準」, and its save keeps read_points TYPE_DEFAULT/ON — never a phantom OWNER stamp (the owner's old ON is gone).
import { seedRecord, stampSave } from '@/business/lib/store-page/model'
describe('S75 fix 2 — R-A the room follows a locked-type save', () => {
  it('beauty_chiropractic read_points OWNER/ON → dental_clinic → 保存 → 0件, a second press no-ops → pick back → ON / 業種の標準 → 保存 → TYPE_DEFAULT/ON, no OWNER stamp', async () => {
    const base = seedRecord('beauty_chiropractic')
    const owned: CapRecord = { ...base, switches: { ...base.switches, read_points: { on: true, source: 'OWNER', changed_at: '2026-10-01T00:00:00.000Z', changed_by: 'staff-1' } } }
    let answer: CapRecord | null = null
    const calls = stub((b) => {
      answer = stampSave(answer ?? owned, b.record as CapRecord, b.reset_keys as CapKey[], new Date('2026-10-06T12:00:00.000Z'), 'staff-1')
      return { status: 200, body: { ok: true, record: answer } }
    })
    const p = await propsFor(STORE.tokyo)
    const sec = p.sections.find((s) => s.id === SP)!
    ;(sec as { storePage: unknown }).storePage = { ...sec.storePage!, saved: owned }
    await mount(p)
    expect(sw('read_points').getAttribute('aria-checked')).toBe('true')
    await act(async () => { fireEvent.change(typeSelect(), { target: { value: 'dental_clinic' } }) })
    expect(sw('read_points').getAttribute('aria-checked')).toBe('false')
    expect(count()).toBe('変更した設定 1件')
    await press()
    expect(calls).toHaveLength(1)
    expect((calls[0].body.record as CapRecord).switches.read_points.on).toBe(false)
    const got = answer as unknown as CapRecord
    expect(got.switches.read_points).toMatchObject({ on: false, source: 'TYPE_DEFAULT' })
    expect(alerts()).toEqual([])
    expect(count()).toMatch(/^✓ 保存しました /) // 0 changes: no phantom 「変更した設定 1件」
    await press()
    expect(calls).toHaveLength(1) // the second press sends nothing
    await act(async () => { fireEvent.change(typeSelect(), { target: { value: 'beauty_chiropractic' } }) })
    expect(count()).toBe('変更した設定 1件') // the 業種 alone
    expect(sw('read_points').getAttribute('aria-checked')).toBe('true') // R-E: the table's standard, the lock lifted
    expect(src('read_points')).toBe('業種の標準')
    expect(src('read_points')).toBe(sourceLine(got, 'read_points'))
    await press()
    expect(calls).toHaveLength(2)
    expect((calls[1].body.record as CapRecord).switches.read_points.on).toBe(true)
    const again = answer as unknown as CapRecord
    expect(again.business_type).toBe('beauty_chiropractic')
    expect(again.switches.read_points).toEqual({ on: true, source: 'TYPE_DEFAULT' }) // NO OWNER stamp
    expect(alerts()).toEqual([])
    expect(count()).toMatch(/^✓ 保存しました /)
    expect(sw('read_points').getAttribute('aria-checked')).toBe('true')
    expect(src('read_points')).toBe('業種の標準')
  })

  it('an edit made while the save is in flight is kept (only ids still holding their sent value follow the 200)', async () => {
    let release: (a: Answer) => void = () => {}
    stub((b) => new Promise<Answer>((r) => { release = r }).then(() => echo(b)))
    await mount(await propsFor(STORE.tokyo))
    await flip(K)
    await act(async () => { fireEvent.click(saveBtn()) })
    await flip(K2)
    const k2 = sw(K2).getAttribute('aria-checked')
    await act(async () => { release({ status: 200, body: null }) })
    await act(async () => {})
    expect(sw(K2).getAttribute('aria-checked')).toBe(k2)
    expect(count()).toBe('変更した設定 1件')
  })
})

// S75 fix 3b (R-E′) — the room's TOUCHED set: a TYPE_DEFAULT key the owner (or 戻す) has not flipped since the last save
// reads the draft type's standard; a touched key keeps the room's value; 元に戻す and a caps 200 clear it.
describe('S75 fix 3b — R-E′ the touched set in the 設定 room', () => {
  const at = new Date('2026-10-06T12:00:00.000Z')
  const withSaved = async (rec: CapRecord) => {
    const p = await propsFor(STORE.tokyo)
    const sec = p.sections.find((s) => s.id === SP)!
    ;(sec as { storePage: unknown }).storePage = { ...sec.storePage!, saved: rec }
    return p
  }
  const pickType = async (t: string) => { await act(async () => { fireEvent.change(typeSelect(), { target: { value: t } }) }) }
  const doorStub = (first: CapRecord) => {
    const state: { answer: CapRecord | null } = { answer: null }
    const calls = stub((b) => {
      state.answer = stampSave(state.answer ?? first, b.record as CapRecord, b.reset_keys as CapKey[], at, 'staff-1')
      return { status: 200, body: { ok: true, record: state.answer } }
    })
    return { calls, state }
  }
  const owned = (): CapRecord => {
    const base = seedRecord('beauty_chiropractic')
    return { ...base, switches: { ...base.switches, read_points: { on: true, source: 'OWNER', changed_at: '2026-10-01T00:00:00.000Z', changed_by: 'staff-1' } } }
  }

  it('(b) after the pick back the owner flips read_points OFF by hand → it stays OFF → 保存 → OWNER/false', async () => {
    const { calls, state } = doorStub(owned())
    await mount(await withSaved(owned()))
    await pickType('dental_clinic')
    await press()
    await pickType('beauty_chiropractic')
    expect(sw('read_points').getAttribute('aria-checked')).toBe('true')
    await flip('read_points')
    expect(sw('read_points').getAttribute('aria-checked')).toBe('false') // touched: the room's value, not the standard
    await press()
    expect(calls).toHaveLength(2)
    expect((calls[1].body.record as CapRecord).switches.read_points.on).toBe(false)
    expect(state.answer!.switches.read_points).toEqual({ on: false, source: 'OWNER', changed_at: at.toISOString(), changed_by: 'staff-1' })
    expect(sw('read_points').getAttribute('aria-checked')).toBe('false')
  })

  it('(c) D2(d): 戻す hair_salon on beauty_chiropractic, one moved key set back by hand → it stays → 保存 → OWNER', async () => {
    const saved = seedRecord('beauty_chiropractic')
    const { calls, state } = doorStub(saved)
    await mount(await withSaved(saved))
    await pickType('hair_salon')
    await typeReset()
    const moved = resetDiff({ ...saved, business_type: 'hair_salon' }).flips.map((f) => f.key)
    expect(moved.length).toBeGreaterThan(1)
    const [back, left] = moved
    expect(sw(back).getAttribute('aria-checked')).toBe(String(!saved.switches[back].on))
    await flip(back)
    expect(sw(back).getAttribute('aria-checked')).toBe(String(saved.switches[back].on)) // stays where the owner put it
    await press()
    expect(calls).toHaveLength(1)
    expect(state.answer!.switches[back]).toEqual({ on: saved.switches[back].on, source: 'OWNER', changed_at: at.toISOString(), changed_by: 'staff-1' })
    expect(state.answer!.switches[left]).toEqual({ on: !saved.switches[left].on, source: 'TYPE_DEFAULT' })
    expect(sw(back).getAttribute('aria-checked')).toBe(String(saved.switches[back].on))
  })

  it('(d) an unsaved round trip with read_points TYPE_DEFAULT/ON: dental_clinic (OFF) → back → ON 「業種の標準」, nothing to send', async () => {
    const saved = seedRecord('beauty_chiropractic')
    expect(saved.switches.read_points).toEqual({ on: true, source: 'TYPE_DEFAULT' })
    const { calls } = doorStub(saved)
    await mount(await withSaved(saved))
    await pickType('dental_clinic')
    expect(sw('read_points').getAttribute('aria-checked')).toBe('false')
    await pickType('beauty_chiropractic')
    expect(sw('read_points').getAttribute('aria-checked')).toBe('true')
    expect(src('read_points')).toBe('業種の標準')
    await press()
    expect(calls).toHaveLength(0)
  })

  it('(h) a hand flip, then 元に戻す, then the pick-back overlay works again (元に戻す clears touched)', async () => {
    const { state } = doorStub(owned())
    await mount(await withSaved(owned()))
    await pickType('dental_clinic')
    await press() // saved: dental_clinic, read_points TYPE_DEFAULT/OFF
    expect(state.answer!.switches.read_points).toMatchObject({ on: false, source: 'TYPE_DEFAULT' })
    await pickType('beauty_chiropractic')
    await flip('read_points')
    expect(sw('read_points').getAttribute('aria-checked')).toBe('false')
    await undo()
    expect(typeSelect().value).toBe('dental_clinic')
    await pickType('beauty_chiropractic')
    expect(sw('read_points').getAttribute('aria-checked')).toBe('true') // untouched again: the standard
    expect(src('read_points')).toBe('業種の標準')
  })
})

// S75 fix 4 (R-F, GREPTILE-1138 P1) — a caps 200 clears `touched` by EDIT, not by value: a key edited during the flight
// stays touched even when the edit lands on the value that was sent.
describe('S75 fix 4 — R-F an edit during the flight keeps its key touched', () => {
  it('(1) 戻す hair_salon (packs OFF) → 保存 → in flight 戻す beauty_chiropractic + hand flip packs OFF → 200 → packs stays OFF → 保存 → OWNER/false', async () => {
    const at = new Date('2026-10-06T12:00:00.000Z')
    const saved = seedRecord('beauty_chiropractic')
    expect(saved.switches.packs).toEqual({ on: true, source: 'TYPE_DEFAULT' })
    let answer: CapRecord | null = null
    let release: () => void = () => {}
    let held = true
    const calls = stub((b) => {
      const stamp = (): Answer => {
        answer = stampSave(answer ?? saved, b.record as CapRecord, b.reset_keys as CapKey[], at, 'staff-1')
        return { status: 200, body: { ok: true, record: answer } }
      }
      return held ? new Promise<Answer>((res) => { release = () => res(stamp()) }) : stamp()
    })
    const p = await propsFor(STORE.tokyo)
    const sec = p.sections.find((s) => s.id === SP)!
    ;(sec as { storePage: unknown }).storePage = { ...sec.storePage!, saved }
    await mount(p)
    await act(async () => { fireEvent.change(typeSelect(), { target: { value: 'hair_salon' } }) })
    await typeReset()
    expect(sw('packs').getAttribute('aria-checked')).toBe('false')
    await act(async () => { fireEvent.click(saveBtn()) })
    expect(calls).toHaveLength(1)
    expect((calls[0].body.record as CapRecord).switches.packs.on).toBe(false)
    await act(async () => { fireEvent.change(typeSelect(), { target: { value: 'beauty_chiropractic' } }) })
    await typeReset()
    expect(sw('packs').getAttribute('aria-checked')).toBe('true')
    await flip('packs')
    expect(sw('packs').getAttribute('aria-checked')).toBe('false') // = the value sent
    held = false
    await act(async () => { release() })
    await act(async () => {})
    expect(alerts()).toEqual([])
    expect(sw('packs').getAttribute('aria-checked')).toBe('false') // still touched: the owner's choice, not the standard
    await press()
    expect(calls).toHaveLength(2)
    expect((calls[1].body.record as CapRecord).switches.packs.on).toBe(false)
    expect(answer!.switches.packs).toEqual({ on: false, source: 'OWNER', changed_at: at.toISOString(), changed_by: 'staff-1' })
    expect(sw('packs').getAttribute('aria-checked')).toBe('false')
  })
})
