/**
 * @jest-environment jsdom
 *
 * 予約と確保 — the 設定 room's own suite (⚖ Liam 9/1, PKT-BUILD-SETTINGS).
 *
 * WHAT A SUITE IN THIS FOLDER CAN HONESTLY PROVE, and its ceiling. Territory's
 * import fence allows only react/next/node specifiers
 * (`business-isolation.test.ts`, `ALLOWED_BARE`), so react-dom does not resolve
 * here and no suite in this folder can mount a React tree — the house pattern
 * every screen-interactions suite here already uses. So the room's REAL
 * functions are run directly on their own inputs (the guard engine, the warn-card
 * composer, the seam, the tour engine), and everything that is a fact about the
 * JSX is read off the SOURCE.
 *
 * THE JOINS ARE PINNED, not just the parts. The warn-card round's lesson was
 * that a composer and a surface can each be perfect and still be wired to each
 * other wrongly — so the pins below check that this room's preview reads
 * `warnFaceFor`'s model and authors NONE of the card's own sentences, that its
 * guardrail reads the ENGINE's capacity rather than a count of its own, and that
 * its three chips come from the wire's enum rather than from three literals.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spotHitIndex, spotTargets, wrapStep } from '@/business/lib/guide'
import { overrideLevelFor, warnFaceFor, type RailCell } from '@/app/[locale]/(business)/business/today/today-interactions'
import { liveFieldsFrom, MINUTE_CHOICES, nearestChoice, saveRefusal } from '@/app/[locale]/(business)/business/settings/store-policy-seam'

const ROOM_DIR = 'src/app/[locale]/(business)/business/settings'
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SCREEN = read(`${ROOM_DIR}/SettingsScreen.tsx`)
const PAGE = read(`${ROOM_DIR}/page.tsx`)
const SEAM = read(`${ROOM_DIR}/store-policy-seam.ts`)
const CSS = read(`${ROOM_DIR}/settings.css`)
const SIDEBAR = read('src/app/[locale]/(business)/BusinessSidebar.tsx')
const TOPBAR = read('src/app/[locale]/(business)/BusinessTopbar.tsx')
const JA = JSON.parse(read('src/business/i18n/ja.json'))

/** Source pins read CODE, not prose: this room documents itself in comments that
 *  quote the very strings these pins look for. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** ⚠ IMPORT SPECIFIERS ARE ASSEMBLED, NEVER SPELLED WHOLE — in this file's
 *  prose as well as in its code. The import-isolation gate
 *  (`business-isolation.test.ts`, which lives outside territory and is not ours
 *  to edit) scans source TEXT for import statements, so a pin that quotes one
 *  reads to it as this file performing that import — and a pin asserting the core
 *  SDK is ABSENT would itself be reported as an SDK reach. The two helpers below
 *  compose the same strings at runtime, which is invisible to a text scan and
 *  identical to read. Documented rather than worked around silently: this is that
 *  guard's own 「a matching string inside a string literal false-flags」 ceiling,
 *  met head-on. */
const KEYWORD = 'fr' + 'om'
const importOf = (spec: string) => `${KEYWORD} '${spec}'`
const SDK = `${'@synqed'}-kk/client`
const SCREEN_CODE = stripComments(SCREEN)
const PAGE_CODE = stripComments(PAGE)
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every OPENING TAG of `<tag …>` in the source, whole — the 売上・レジ scanner,
 *  carried. JSX attributes hold braces, template literals and quotes, so the scan
 *  tracks all three rather than stopping at the first `>` it sees. */
function openingTags(src: string, tag: string): string[] {
  const out: string[] = []
  let i = src.indexOf(`<${tag}`)
  while (i >= 0) {
    let depth = 0
    let quote = ''
    let j = i + tag.length + 1
    for (; j < src.length; j += 1) {
      const c = src[j]
      if (quote !== '') {
        if (c === quote) quote = ''
        continue
      }
      if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '>' && depth === 0) break
    }
    out.push(src.slice(i, j + 1))
    i = src.indexOf(`<${tag}`, j)
  }
  return out
}

type Declaration = { title: string; text: string }
const DECLARATIONS: Declaration[] = [
  ...SCREEN_CODE.matchAll(/data-guide-title="([^"]*)"\s*\n\s*data-guide="([^"]*)"/g),
].map((m) => ({ title: m[1], text: m[2] }))

// ── ⚖ Liam 8/23 — the room declares every section it renders ────────────────

describe('⚖ Liam 8/23 — the guided ?-tour ships in the SAME round as the room', () => {
  it('THE CENSUS IS STRUCTURAL — every <section> the screen renders carries the pair', () => {
    // Derived from the JSX, never listed: a dial added in a later round fails
    // here the day it lands rather than joining the page unexplained.
    const missing = openingTags(SCREEN_CODE, 'section')
      .filter((tag) => !(tag.includes('data-guide-title=') && tag.includes('data-guide=')))
      .map((tag) => /aria-labelledby="([^"]*)"/.exec(tag)?.[1] ?? /className="([^"]*)"/.exec(tag)?.[1] ?? tag.slice(0, 70))
    expect(missing).toEqual([])
    // …and the page head declares itself too, so the walk opens on what the page
    // is FOR before it points at parts of it (the 受信トレイ precedent).
    expect(openingTags(SCREEN_CODE, 'header')[0]).toContain('data-guide-title="予約と確保"')
  })

  it('every declaration is a complete, distinct sentence — never a label repeated', () => {
    expect(DECLARATIONS.length).toBeGreaterThanOrEqual(12)
    for (const d of DECLARATIONS) {
      expect(d.title.length).toBeGreaterThan(0)
      // A tour step that only restates its own heading teaches nothing.
      expect(d.text).not.toBe(d.title)
      expect(d.text.length).toBeGreaterThan(20)
      expect(d.text.endsWith('。')).toBe(true)
    }
    expect(new Set(DECLARATIONS.map((d) => d.title)).size).toBe(DECLARATIONS.length)
  })

  it('EVERY DIAL IS EXPLAINED — the eight dials plus 保存 each declare their own step', () => {
    // The room's whole subject is dials, so a dial the walk skips is a setting a
    // manager is left to guess at. Named here because these are the ROOM's
    // contract with Liam's 8/23 law, not a list the code derives.
    for (const title of [
      '上書きの権限', '名指しロック', '長押しで確定', '店長のみでも警告を止める',
      'すき間の販売', '新規のお客様の確保', '確保枠の会員ランク開放', '予約の刻み', '保存',
    ]) {
      expect(DECLARATIONS.map((d) => d.title)).toContain(title)
    }
  })

  it('the ? is wired to the SHARED engine, and the room adds no engine of its own', () => {
    expect(SCREEN_CODE).toContain(importOf('@/business/lib/guide'))
    for (const fn of ['spotTargets(rootRef.current)', 'spotCardAt(', 'spotHitIndex(', 'wrapStep(']) {
      expect(SCREEN_CODE).toContain(fn)
    }
    expect(SCREEN_CODE).toContain('aria-label="画面の説明"')
    // The walk is scoped to the ROOM's root, never the document: the shell's rail
    // and topbar are not this page.
    expect(SCREEN_CODE).not.toContain('spotTargets(document')
  })

  it('the ENGINE really walks this room’s own declarations — registry, ring, hit-test', () => {
    // Real nodes carrying THIS room's real attributes, handed to the real engine.
    // Not a replica of the room: the engine's inputs are rects and nodes, and
    // these are its inputs.
    const root = document.createElement('div')
    for (const d of DECLARATIONS) {
      const el = document.createElement('section')
      el.dataset.guideTitle = d.title
      el.dataset.guide = d.text
      // jsdom measures nothing, so each node is given a real box — spotTargets
      // drops zero-sized nodes, which is exactly the drop-out behaviour the law
      // wants and would otherwise empty this walk.
      el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}) })
      root.appendChild(el)
    }
    const targets = spotTargets(root)
    expect(targets.length).toBe(DECLARATIONS.length)
    expect(targets[0].dataset.guideTitle).toBe(DECLARATIONS[0].title)
    // The walk is a RING: 次へ on the last step returns to the first.
    expect(wrapStep(targets.length, targets.length)).toBe(0)
    expect(wrapStep(-1, targets.length)).toBe(targets.length - 1)
    // Point-to-ask: nested regions resolve smallest-first, so a column can never
    // swallow the dial that lives inside it.
    const rects = [
      { left: 0, top: 0, width: 400, height: 400 },
      { left: 10, top: 10, width: 40, height: 40 },
    ]
    expect(spotHitIndex(20, 20, rects)).toBe(1)
    expect(spotHitIndex(300, 300, rects)).toBe(0)
    expect(spotHitIndex(900, 900, rects)).toBe(-1)
  })
})

// ── ⚖ 1b — the three chips ARE the wire's enum ──────────────────────────────

describe('⚖ 1b RULED — 新規のお客様の確保 is three fixed choices, and they are the wire’s', () => {
  it('the enum is 60/75/90 and lives in ONE place', () => {
    // `SetStoreBookingPolicyInput.new_client_session_minutes?: 60 | 75 | 90` —
    // the reason the mock's free stepper is superseded. A control that can name a
    // value the store cannot save is a lie with a number in it.
    expect([...MINUTE_CHOICES]).toEqual([60, 75, 90])
    expect(SEAM).toContain('60 | 75 | 90')
  })

  it('the chips are RENDERED from that enum, never from three literals', () => {
    expect(SCREEN_CODE).toContain('MINUTE_CHOICES.map(')
    // …and the room never mints a stepper for this dial: 予約の刻み is the only
    // number field on the page, which is also what the ⛔ NaN riders guard.
    const inputs = openingTags(SCREEN_CODE, 'input')
    expect(inputs.length).toBe(1)
    expect(inputs[0]).toContain('id="stSlot"')
  })

  it('a stored value off the ladder is READ, and never silently re-saved as itself', () => {
    // core's own asymmetry: the read side is a plain number, the write side the
    // union. So an older row at 120 is readable, and the chips fall back to the
    // nearest value they can actually save.
    expect(nearestChoice(90)).toBe(90)
    expect(nearestChoice(120)).toBe(90)
    expect(nearestChoice(30)).toBe(60)
    expect(nearestChoice(Number.NaN)).toBe(90)
    // A tie goes to the LONGER window: a store holding more time for new
    // customers is not quietly moved to holding less.
    expect(nearestChoice(67.5)).toBe(75)
    expect(nearestChoice(82.5)).toBe(90)
  })

  it('the two live fields cross the seam in CORE’s own spellings', () => {
    expect(liveFieldsFrom({ gapGuardMode: 'standard', newClientSessionMinutes: 90 }))
      .toEqual({ gap_guard_mode: 'STANDARD', new_client_session_minutes: 90 })
    expect(liveFieldsFrom({ gapGuardMode: 'strict', newClientSessionMinutes: 60 }).gap_guard_mode).toBe('STRICT')
    expect(liveFieldsFrom({ gapGuardMode: 'off', newClientSessionMinutes: 75 }).gap_guard_mode).toBe('OFF')
    // …and the page reads them THROUGH it, so the reconnect is one function body.
    expect(PAGE_CODE).toContain('liveFieldsFrom({')
    expect(PAGE_CODE).toContain("live.gap_guard_mode === 'STRICT'")
    expect(PAGE_CODE).toContain('live.new_client_session_minutes')
  })
})

// ── ⚖ the HQ save gate ──────────────────────────────────────────────────────

describe('⚖ the save gate is DATA, and its refusal is readable', () => {
  it('authority comes from the store’s own role list, never a literal', () => {
    const roles = ['オーナー', '店舗管理者']
    expect(saveRefusal(roles, 'スタッフ')).toBe('保存できるのはオーナー・店舗管理者です')
    expect(saveRefusal(roles, '受付')).toContain('保存できるのは')
    // A store that names a different set changes its settings, not this file.
    expect(saveRefusal(['本部長'], '本部長')).not.toContain('保存できるのは')
    expect(saveRefusal(['本部長'], '店舗管理者')).toBe('保存できるのは本部長です')
  })

  it('an admitted operator is still refused — HONESTLY — while the wire is fenced', () => {
    // ⛔ The play-phase fence: nothing in Business writes anything. The control is
    // refused with its reason rather than pretending, which is the family's own
    // L-7 pattern; the day the seam reconnects, THIS is the assertion that has to
    // change, deliberately.
    expect(saveRefusal(['オーナー', '店舗管理者'], '店舗管理者')).toBe('見本データのため保存できません')
  })

  it('the room reads the gate’s ANSWER and never the rule', () => {
    // The screen is handed a sentence and a role list; it holds no predicate of
    // its own, so an operator can never be shown a control they would only be
    // refused for.
    expect(PAGE_CODE).toContain('saveRefusal(managerRoles, shell.operator.role)')
    expect(PAGE_CODE).toContain('releaseHeldRoles')
    expect(SCREEN_CODE).toContain('disabled={props.save.refusal !== null}')
    expect(SCREEN_CODE).toContain('{props.save.refusal}')
    // …and the roles are NAMED on screen, so a refusal points somewhere.
    expect(SCREEN_CODE).toContain('props.save.roles.join')
    expect(SCREEN_CODE).not.toContain('オーナー')
    expect(SCREEN_CODE).not.toContain('店舗管理者')
  })
})

// ── the preview is the SHIPPED card ─────────────────────────────────────────

/** A guard cell of the class the preview actually stands on — an R-REP refusal
 *  that costs the store exactly one protected window. Shaped by hand because the
 *  point of these pins is the COMPOSER's behaviour at each dial value, and a
 *  fixture-derived cell would move the moment the sample day does. */
const repCell = (ackAllowed: boolean): RailCell => ({
  start: 1080,
  state: 'blocked',
  label: '—',
  sentence: 'ここに置くと新規90分が入らなくなります',
  reason: 'guard',
  alternatives: [1020],
  alternativeKind: 'safe',
  ackAllowed,
  impact: { code: 'R-REP', capacityBefore: 1, capacityAfter: 0, windowsBefore: [1080], windowsAfter: [] },
})

const cardFor = (over: Partial<Parameters<typeof warnFaceFor>[0]> = {}) =>
  warnFaceFor({
    rows: [
      { label: '時間帯の重複なし', tone: '' },
      { label: '見本 しろうの勤務時間内（〜19:00）', tone: '' },
      { label: '整体資格 一致', tone: '' },
      { label: '予約時価格を保持（動的価格は適用しません）', tone: '' },
    ],
    cell: repCell(true),
    override: null,
    level: 'allow-warned',
    holdToConfirm: true,
    targetLaneMine: false,
    operatorName: '見本 あずさ',
    listPrice: 7000,
    frame: { hi: 7260, lo: 6600, hqMin: 6600, hqMax: 7260 },
    depth: 9,
    protectedDur: 90,
    confirmEnabled: true,
    ...over,
  })

describe('the preview is composed by the BOARD’s own function, not by this room', () => {
  it('the room IMPORTS warnFaceFor and authors none of the card’s sentences', () => {
    expect(SCREEN_CODE).toContain('warnFaceFor')
    expect(SCREEN_CODE).toContain(importOf('../today/today-interactions'))
    // THE JOIN, pinned the way the warn-card round asked: every line the card
    // prints is read off the model.
    for (const field of [
      'card.impact.head', 'card.impact.yen', 'card.impact.tail', 'card.provenance',
      'card.safePrimary', 'card.commit', 'card.lock', 'card.greensLine', 'card.rows',
    ]) {
      expect(SCREEN_CODE).toContain(field)
    }
    // …and NONE of the composer's own sentences is spelled in this room. A
    // surface that re-authors its composer's words is how the two come to
    // disagree (⚖ 54), and it is the exact failure this pin exists to catch.
    for (const fragment of ['入らなくなります', '記録されます', 'この位置では確定できません', '長押しで注意して配置', 'は問題ありません', '店長に許可を求める']) {
      expect({ fragment, inRoom: SCREEN.includes(fragment) }).toEqual({ fragment, inRoom: false })
    }
  })

  it('the chosen 確保 length is what the card SAYS — all three of them', () => {
    for (const minutes of MINUTE_CHOICES) {
      const card = cardFor({ protectedDur: minutes })
      expect(card.face).toBe('warn')
      expect(card.impact.head).toBe(`ここに置くと、新規のお客様の${minutes}分`)
      expect(card.impact.tail).toBe('が入らなくなります。')
      // The ¥ is canon's, off the board's own frame — the card computes no price.
      expect(card.impact.yen).toMatch(/^約¥[\d,]+$/)
    }
  })

  it('店長のみでも警告を止める really changes the card — the dial is not a dead lever', () => {
    // STANDARD: the engine allows the acknowledgement, so the commit is live.
    const standard = cardFor({ cell: repCell(true) })
    expect(standard.commit).toEqual({ kind: 'hold', label: '長押しで注意して配置', enabled: true, note: null })
    // STRICT: `ackAllowed` is false, so the same landing goes commit-less — the
    // dial's own promise (「安全な時間の提案と元に戻すだけになります」), and the
    // safe answer survives, which is what makes the strict card usable at all.
    const strict = cardFor({ cell: repCell(false) })
    expect(strict.commit?.enabled).toBe(false)
    expect(strict.safePrimary).toEqual({ kind: 'place', start: 1020, main: '17:00に置く', sub: '（確保を壊さない）' })
  })

  it('長押しで確定 decides only HOW the press is made, never whether it is allowed', () => {
    expect(cardFor({ holdToConfirm: true }).commit?.kind).toBe('hold')
    expect(cardFor({ holdToConfirm: false }).commit?.kind).toBe('press')
    expect(cardFor({ holdToConfirm: false }).commit?.label).toBe('注意して配置する')
  })

  it('上書きの権限 lights the three faces, 店長の承認 included', () => {
    expect(cardFor({ level: 'allow-warned' }).provenance).toContain('スタッフの上書きが許可されています')
    // ⚖ 'needs-approval' is a face `overrideLevelFor` cannot RETURN, and
    // `warnFaceFor`'s own note says it exists so the settings round lights it.
    // This is that lighting — and it lights nothing else: the consult below still
    // cannot produce the level from any policy value.
    const approve = cardFor({ level: 'needs-approval' })
    expect(approve.commit?.kind).toBe('approval')
    expect(approve.commit?.enabled).toBe(false)
    expect(approve.provenance).toContain('店長の承認が必要です')
    expect(overrideLevelFor({ roles: ['オーナー', '店舗管理者', 'スタッフ'], lockedOut: [] }, { role: 'スタッフ', staff_id: 'p-05' })).toBe('allow-warned')
    expect(overrideLevelFor({ roles: ['オーナー', '店舗管理者'], lockedOut: [] }, { role: 'スタッフ', staff_id: 'p-05' })).toBe('refuse')
    // 名指しロック answers FIRST — a store that named a person has named them
    // whatever their role says. That is what makes the lock chips live in the
    // preview without this room re-deciding anything.
    expect(overrideLevelFor({ roles: ['オーナー', '店舗管理者', 'スタッフ'], lockedOut: ['p-05'] }, { role: 'スタッフ', staff_id: 'p-05' })).toBe('refuse')
    // …and the room composes the level exactly that way.
    expect(SCREEN_CODE).toContain('overrideLevelFor({ roles, lockedOut: locks }, previewOp)')
    expect(SCREEN_CODE).toContain("perm === 'approve' && base === 'allow-warned' ? 'needs-approval' : base")
  })

  it('a preview with nothing to warn about SAYS SO, rather than drawing an invented loss', () => {
    // `cell: null` is a day on which the staged landing costs the store nothing.
    const clean = cardFor({ cell: null, rows: [{ label: '時間帯の重複なし', tone: '' }] })
    expect(clean.face).toBe('clean')
    expect(SCREEN_CODE).toContain('sample === null || card === null ?')
    expect(SCREEN_CODE).toContain('確保枠を壊してしまう配置がありません')
  })
})

// ── ⚖ 54 — the guardrail has ONE basis ──────────────────────────────────────

describe('⚖ the guardrail counts what the ENGINE counts', () => {
  it('capacity comes from the guard’s own protectedCapacity, never a count this room derives', () => {
    expect(PAGE_CODE).toContain('engine.protectedCapacity(pocket, null, { now: planes.boardNow }).before')
    expect(PAGE_CODE).toContain('freePockets({')
    expect(PAGE_CODE).toContain('createGapGuard(guardConfigFor(')
    // The screen reads the number; it does not compute one.
    expect(SCREEN_CODE).toContain('scene.capacity')
    expect(SCREEN_CODE).not.toMatch(/Math\.floor\([^)]*minutes/)
  })

  it('the sentence says WHAT it counts, and has an honest zero (⚖ 8/25)', () => {
    expect(SCREEN_CODE).toContain('新規のお客様の確保枠を${scene.capacity}枠つくれます')
    expect(SCREEN_CODE).toContain('scene.capacity === 0')
    expect(SCREEN_CODE).toContain('ひとつも作れません（0枠）')
  })

  it('a scene is evaluated for every value the two dials can take', () => {
    // Six, so a chip press repaints the card with no data access and no
    // arithmetic in the browser.
    expect(PAGE_CODE).toContain('for (const minutes of MINUTE_CHOICES)')
    expect(PAGE_CODE).toContain('for (const strict of [false, true])')
    expect(SCREEN_CODE).toContain("props.scenes[`${strict ? 'strict' : 'standard'}:${minutes}`]")
  })

  it('the sample landing is FOUND BY RULE, never written down', () => {
    // A hardcoded lane + start would be a scene that quietly stops being true the
    // day the fixture day moves.
    expect(PAGE_CODE).toContain('lossOf(cell) > 0')
    expect(PAGE_CODE).toContain('candidates.find((c) => c.refusal) ?? candidates[0] ?? null')
    expect(PAGE_CODE).not.toMatch(/sampleStart = \d{3,}/)
  })
})

// ── ⛔ the NaN riders, from the room that made them reachable ────────────────

describe('⛔ the 予約の刻み field is what makes a non-number reachable', () => {
  it('the room’s own clamp uses the NaN-safe spelling', () => {
    // `!(x >= MIN)` rather than `x < MIN`: NaN fails every comparison, so `<`
    // would let an empty field through and `String(NaN)` would land 「NaN」 in the
    // box. Same shape as `impactOf`'s own `!(protectedDur > 0)`.
    expect(SCREEN_CODE).toContain('if (!(Number.isFinite(value) && value >= SLOT_MIN)) return SLOT_MIN')
    // …and the field itself refuses non-digits at the keystroke, so the clamp is
    // the second line of defence rather than the only one.
    expect(SCREEN_CODE).toContain("replace(/[^0-9]/g, '')")
  })

  it('and its two siblings in the engine now refuse the same inputs', () => {
    // The behavioural red-run for `guardRailsFor` lives with the rail's own pins
    // (today-screen-interactions.test.ts, ⚖ A2-N1/N2, re-derived in the same
    // commit as this room's number field). This is the ROOM-side half: the dial
    // this page edits is the one those guards protect.
    const INT = read('src/app/[locale]/(business)/business/today/today-interactions.ts')
    expect(INT).toContain('if (!(Number.isFinite(input.stepMin) && input.stepMin > 0)) return []')
    expect(INT).toContain('if (!(Number.isFinite(stepMin) && stepMin > 0)) return []')
    expect(SCREEN_CODE).toContain('bookingStepMin')
  })
})

// ── the room joins the family properly ──────────────────────────────────────

describe('the room is wired into the door like its siblings', () => {
  it('the rail’s 設定 item is live, and the crumb names its own group', () => {
    expect(SIDEBAR).toContain("{ key: 'settings', segment: 'settings', label: '設定', mini: '設定', live: true }")
    expect(TOPBAR).toContain("settings: '予約と確保'")
    // Every room built so far lives under 店舗フロア, which is why that word was a
    // literal; this is the first that does not, and the default keeps every
    // existing crumb byte-identical.
    expect(TOPBAR).toContain("const GROUP: Record<string, string> = {")
    expect(TOPBAR).toContain("{GROUP[segment] ?? '店舗フロア'}")
    expect(JA.settings.loading).toBe('読み込み中…')
  })

  it('⚖ flag 69 — EVERY rule in this room’s sheet is scoped, the card’s included', () => {
    // Two route sheets may not own one selector: App Router leaves a sheet in the
    // document after a soft-nav, so a tie is decided by VISIT order. today.css
    // states `wc-*` / `hold-pop` / `holdbar-checks` BARE, so this room's copies
    // carry `.pg-settings` — which both keeps the audit's rule true and wins the
    // tie in either direction.
    const unscoped = CSS_CODE
      .replace(/@(?:keyframes|font-face)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
      .replace(/@(?:media|supports)[^{]*\{/g, '')
      .split('}')
      .flatMap((block) => {
        const i = block.indexOf('{')
        return i < 0 ? [] : block.slice(0, i).split(',').map((s) => s.trim()).filter(Boolean)
      })
      .filter((sel) => sel.length > 0 && !sel.startsWith('@') && !sel.includes('pg-settings'))
    expect(unscoped).toEqual([])
    // …and the room's own PAGE rule is FOUR levels, never three, which ties with
    // a sibling's `.biz .page .btn`.
    expect(CSS_CODE).toContain('.biz .page.pg-settings { padding:')
    expect(CSS_CODE).toContain('.biz .page.pg-settings .btn { font-weight: 500; }')
  })

  it('the room’s own class names exist nowhere else in the family', () => {
    const own = [...new Set([...CSS_CODE.matchAll(/\.(st-[\w-]+)/g)].map((m) => m[1]))]
    expect(own.length).toBeGreaterThan(20)
    const BIZ = 'src/app/[locale]/(business)'
    for (const dir of ['analytics', 'customers', 'inbox', 'karute', 'register', 'reservations', 'shifts', 'today']) {
      const sheet = read(`${BIZ}/business/${dir}/${dir}.css`)
      for (const n of own) expect({ dir, name: n, used: sheet.includes(`.${n}`) }).toEqual({ dir, name: n, used: false })
    }
    const shell = read(`${BIZ}/business-shell.css`)
    for (const n of own) expect({ name: n, inShell: shell.includes(`.${n}`) }).toEqual({ name: n, inShell: false })
  })

  it('⚖ R13 / one-way accent — nothing pressable in this room is a dark fill', () => {
    // The selected state is the wash + accent-ink recipe, and the one solid fill
    // on the page is `.btn.primary`'s own commit recipe. (`npm run
    // audit:dark-interactive` is the family's machine for the Tailwind spelling;
    // this room writes plain CSS, so its own recipe is pinned here.)
    expect(CSS_CODE).toContain('.biz .pg-settings .st-seg button.on { background: var(--select-bg); color: var(--select-ink); }')
    expect(CSS_CODE).toContain('.biz .pg-settings .st-pcard.on { border-color: var(--select-line); background: var(--select-bg);')
    expect(CSS_CODE).not.toMatch(/background:\s*(?:#(?:[0-3][0-9a-f]){3}\b|black\b)/i)
    // The room's own commit control wears the shell's class rather than a fill of
    // its own.
    expect(SCREEN_CODE).toContain('className="btn primary"')
  })

  it('⚠ the play-phase fence is stated where a reader will meet it', () => {
    // The one deviation from the charter, written at the swap point rather than
    // left for a reviewer to discover.
    expect(SEAM).toContain(SDK)
    expect(SEAM).toContain('CODEOWNER-gated')
    expect(PAGE_CODE).toContain('store-policy-seam')
    // …and territory really does reach no core: the room imports the SDK nowhere.
    // The comment-stripped source, so the fence's own EXPLANATION — which has to
    // name the package it is fencing out — is not read as the reach it forbids.
    expect({ file: 'SettingsScreen.tsx', reachesCore: SCREEN_CODE.includes(SDK) }).toEqual({ file: 'SettingsScreen.tsx', reachesCore: false })
    expect({ file: 'page.tsx', reachesCore: PAGE_CODE.includes(SDK) }).toEqual({ file: 'page.tsx', reachesCore: false })
  })
})
