/**
 * @jest-environment jsdom
 *
 * 設定 — ⚖ Liam's 8/23 GUIDED ?-TOUR law, this room's half, plus the pieces of
 * behaviour that are only true in a browser: the phone's list/detail swap, the
 * one section that persists outside this screen, and the DEMO-INTERACTION
 * machinery every control now runs through.
 *
 * THE CENSUS IS STRUCTURAL, and it is asked from BOTH sides — the room-4 lesson,
 * inherited: a census that only counts what declares itself can never notice what
 * does not.
 *
 *   · HERE, on the source: every `<section>`, `<header>` and `<aside>` this
 *     screen renders must carry the `data-guide-title` + `data-guide` pair,
 *     derived from the JSX itself — there is no list to keep in sync, and a new
 *     element that forgets to declare fails the round the day it lands.
 *   · IN THE BROWSER, on the REAL rendered DOM (`probe/`): the census is taken
 *     again on several sections, every declared element is TAPPED, every control
 *     is OPERATED, and the card is measured against the hole. That is where
 *     containment and the dead-lever law are decided, because both are facts
 *     about rects and effects and this file has no layout to decide them in.
 *
 * ⚠ THIS ROOM'S TOUR DECLARES ROWS AND BLOCK HEADS, NOT THE PANEL, and the
 * reason is a placement fact rather than a teaching preference: a target taller
 * than the viewport leaves the engine's card nowhere to go but on top of the
 * thing it explains (the room-5 F5 defect). 「What does THIS control do」 is also
 * the question a settings page is actually asked, so the two agree.
 *
 * MECHANISM, and its honest ceiling. Territory's import fence allows only
 * react/next/node specifiers, so react-dom does not resolve here and no suite in
 * this folder can mount a React tree — the house pattern every screen-
 * interactions suite here already uses. The pure engine (`spotTargets` /
 * `spotHitIndex` / `wrapStep` / `spotCardAt`) and the room's own pure
 * interaction rules (`sectionDirty`, `fillTemplate`, `commitNumber`,
 * `blockingError`) ARE really run, over inputs they are handed directly.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep } from '@/business/lib/guide'
import {
  accessFor,
  blockingError,
  fillTemplate,
  firstOpenSection,
  keepCardOffHeading,
  labelOfValue,
  PREFS_DEFAULT,
  readPrefs,
  sectionDirty,
  type ControlKind,
  type RowValue,
  type SettingsSection,
} from '@/business/lib/settings'

const ROOM_DIR = 'src/app/[locale]/(business)/business/settings'
const SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/SettingsScreen.tsx`), 'utf8')
const CSS = readFileSync(join(process.cwd(), `${ROOM_DIR}/settings.css`), 'utf8')

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
const SRC_CODE = stripComments(SRC).replace(/^\s*\/\/.*$/gm, '')
const CSS_CODE = stripComments(CSS)

/** Every OPENING TAG of `<tag …>` in the source, whole. JSX attributes hold
 *  braces, template literals and quotes, so the scan tracks all three rather than
 *  stopping at the first `>` it sees — a regex would cut
 *  `className={`${ROOT}${isDetail ? …}`}` in half and report an element that
 *  declares nothing. */
function openingTags(src: string, tag: string): Array<{ text: string; at: number }> {
  const out: Array<{ text: string; at: number }> = []
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
    out.push({ text: src.slice(i, j + 1), at: i })
    i = src.indexOf(`<${tag}`, j)
  }
  return out
}

const DECLARATIONS = [...SRC_CODE.matchAll(/data-guide-title=(?:"([^"]*)"|\{([^}]*)\})\s*\n?\s*data-guide=(?:"([^"]*)"|\{([^}]*)\})/g)]

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ 8/23 — the 画面の説明 census, derived from the source rather than listed', () => {
  it('every section, header and aside DECLARES itself — no list to keep in sync', () => {
    const undeclared: string[] = []
    for (const tag of ['section', 'header', 'aside']) {
      for (const el of openingTags(SRC_CODE, tag)) {
        if (el.text.includes('data-guide-title') && el.text.includes('data-guide=')) continue
        undeclared.push(el.text.replace(/\s+/g, ' ').slice(0, 90))
      }
    }
    expect({ undeclared }).toEqual({ undeclared: [] })
  })

  it('the declarations are PAIRED — a title with no text explains nothing', () => {
    const titles = openingTags(SRC_CODE, 'section')
      .concat(openingTags(SRC_CODE, 'header'), openingTags(SRC_CODE, 'aside'))
      .filter((el) => el.text.includes('data-guide-title')).length
    expect(DECLARATIONS.length).toBeGreaterThanOrEqual(titles)
    for (const m of DECLARATIONS) {
      const title = m[1] ?? m[2] ?? ''
      const text = m[3] ?? m[4] ?? ''
      expect({ title, ok: title.length > 0 }).toEqual({ title, ok: true })
      expect({ title, ok: text.length > 0 }).toEqual({ title, ok: true })
    }
  })

  it('every row and every block declares itself from its OWN copy', () => {
    // ⚠ THE STEP IS COMPOSED FROM THE ROW'S OWN WORDS, so a control that arrives
    // with a guardrail arrives with a tour step that states it. There is no
    // second sentence to write and none to forget.
    expect(SRC_CODE).toContain('data-guide-title={row.label}')
    expect(SRC_CODE).toContain("data-guide={`${row.description || row.label + 'の設定です。'} ${row.trio?.guardrail ?? ''}`.trim()}")
    expect(SRC_CODE).toContain('data-guide-title={block.title}')
    expect(SRC_CODE).toContain('data-guide={block.note || `${block.title}の設定です。`}')
  })

  it('NO declared element is a whole panel — the walk points at rows and blocks', () => {
    // The room-5 F5 defect: a target taller than the viewport forces the engine's
    // last resort, which puts the card on top of the thing it is explaining. This
    // room declares rows, blocks and cards, never `.st-panel`, `.st-main` or
    // `.st-cols`.
    for (const container of ['st-panel', 'st-main', 'st-cols', 'st-body']) {
      const el = openingTags(SRC_CODE, 'div').find((d) => d.text.includes(`className="${container}"`))
      expect({ container, declares: el?.text.includes('data-guide') ?? false }).toEqual({ container, declares: false })
    }
  })

  it('…and the engine’s LAST RESORT is corrected, because a phone row still has no free side', () => {
    expect(SRC_CODE).toContain('keepCardOffHeading(spotCardAt(boxOf(r), size, viewport), size, boxOf(r), viewport)')
  })

  it('the ? is the trigger, the ring wraps, and the keyboard is never stranded', () => {
    expect(SRC_CODE).toContain('aria-label="画面の説明"')
    expect(SRC_CODE).toContain('aria-haspopup="dialog"')
    expect(SRC_CODE).toContain('onClick={() => setTourIdx(0)}')
    expect(SRC_CODE).toContain("if (e.key === 'Escape') setTourIdx(-1)")
    expect(SRC_CODE).toContain('tourNextRef.current?.focus()')
    expect(SRC_CODE).toContain('helpRef.current?.focus()')
  })

  it('⚖ R6-20 — the settle gate is the platform’s own double-click interval', () => {
    expect(SRC_CODE).toContain('const SETTLE_MS = 500')
    expect(SRC_CODE).toContain('if (Date.now() - settledAt.current < SETTLE_MS) return')
    // ⚠ FAILS CLOSED: infinity until the overlay is actually laid out, so the dim
    // layer cannot eat a press it has not earned the right to interpret.
    expect(SRC_CODE).toContain('const settledAt = useRef(Number.POSITIVE_INFINITY)')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the shared engine, really run over this room’s own nodes', () => {
  const rect = (el: HTMLElement, r: { left: number; top: number; width: number; height: number }) => {
    el.getBoundingClientRect = () =>
      ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r }) as DOMRect
  }

  /** A miniature of the room's real shape: the head, the rail, and rows inside a
   *  block inside a panel — declared exactly as the screen declares them. */
  function build() {
    document.body.innerHTML = ''
    const root = document.createElement('div')
    root.className = 'page pg-settings'
    const made: HTMLElement[] = []
    const add = (cls: string, title: string, box: { left: number; top: number; width: number; height: number }, parent: HTMLElement = root) => {
      const el = document.createElement('section')
      el.className = cls
      el.dataset.guideTitle = title
      el.dataset.guide = `${title}の説明。`
      rect(el, box)
      parent.appendChild(el)
      made.push(el)
      return el
    }
    add('st-head', '設定', { left: 24, top: 90, width: 1100, height: 96 })
    add('st-rail', '設定カテゴリー', { left: 24, top: 200, width: 220, height: 640 })
    const panel = document.createElement('div')
    panel.className = 'st-panel'
    rect(panel, { left: 264, top: 200, width: 860, height: 640 })
    root.appendChild(panel)
    const block = add('st-block', '予約ボードの操作', { left: 264, top: 240, width: 560, height: 360 }, panel)
    add('st-dial', 'スキマガード', { left: 274, top: 260, width: 540, height: 130 }, block)
    add('st-dial', '予約の移動単位', { left: 274, top: 420, width: 540, height: 130 }, block)
    add('st-aside', 'この値の出どころ', { left: 844, top: 260, width: 280, height: 220 }, panel)
    document.body.appendChild(root)
    return { root, made }
  }

  it('the walk picks up every declared element, in DOM order', () => {
    const { root } = build()
    const targets = spotTargets(root)
    expect(targets.map((t) => t.dataset.guideTitle)).toEqual([
      '設定',
      '設定カテゴリー',
      '予約ボードの操作',
      'スキマガード',
      '予約の移動単位',
      'この値の出どころ',
    ])
  })

  it('a section that is not on screen drops out of the walk AND out of the count', () => {
    // ⚠ THE ADAPTIVE HALF OF LIAM'S RULE. At ≤743 the panel is `display: none`
    // until a section is picked, so its rows have no box — and the tour's N/M
    // counts what the reader can actually see rather than what the file holds.
    const { root, made } = build()
    for (const el of made.slice(2)) el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    const targets = spotTargets(root)
    expect(targets.map((t) => t.dataset.guideTitle)).toEqual(['設定', '設定カテゴリー'])
    expect(wrapStep(2, targets.length)).toBe(0)
    expect(wrapStep(-1, targets.length)).toBe(1)
  })

  it('the SMALLEST declared region under the pointer wins — a row inside a block', () => {
    const { root } = build()
    const rects = spotTargets(root).map((t) => {
      const r = t.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    })
    // A point inside the first row, which sits inside the block.
    expect(spotHitIndex(300, 300, rects)).toBe(3)
    // A point inside the trace card, which overlaps nothing else.
    expect(spotHitIndex(900, 300, rects)).toBe(5)
    // A point on nothing declared closes the tour (-1).
    expect(spotHitIndex(600, 900, rects)).toBe(-1)
  })

  it('the card never covers the row it is explaining, at a desk’s own geometry', () => {
    const { root } = build()
    const viewport = { width: 1280, height: 800 }
    const card = { width: 300, height: 170 }
    for (const el of spotTargets(root)) {
      const r = el.getBoundingClientRect()
      const box = { left: r.left, top: r.top, width: r.width, height: r.height }
      const at = keepCardOffHeading(spotCardAt(box, card, viewport), card, box, viewport)
      const overlaps =
        at.left < box.left + box.width &&
        at.left + card.width > box.left &&
        at.top < box.top + box.height &&
        at.top + card.height > box.top
      expect({ title: el.dataset.guideTitle, overlaps }).toEqual({ title: el.dataset.guideTitle, overlaps: false })
    }
  })

  it('…and on a PHONE row with no free side, the correction keeps the card off the heading', () => {
    const viewport = { width: 390, height: 844 }
    const card = { width: 300, height: 260 }
    const row = { left: 90, top: 252, width: 286, height: 340 }
    const raw = spotCardAt(row, card, viewport)
    const fixed = keepCardOffHeading(raw, card, row, viewport)
    const headingBottom = row.top + 64
    // Before: the card sits across the row's heading. After: it does not.
    expect(raw.top < headingBottom && raw.top + card.height > row.top).toBe(true)
    expect(fixed.top < headingBottom && fixed.top + card.height > row.top).toBe(false)
    // …and it keeps the x the engine chose, and stays inside the viewport.
    expect(fixed.left).toBe(raw.left)
    expect(fixed.top).toBeGreaterThanOrEqual(10)
    expect(fixed.top + card.height).toBeLessThanOrEqual(viewport.height - 10)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ list-is-the-page — the phone’s own screen, and the way back', () => {
  it('`null` is the LIST state, and picking a row is what opens a section', () => {
    expect(SRC_CODE).toContain('const [picked, setPicked] = useState<string | null>(null)')
    expect(SRC_CODE).toContain('const shownId = picked ?? props.openingSectionId')
    expect(SRC_CODE).toContain('const isDetail = picked !== null')
    expect(SRC_CODE).toContain('onClick={() => setPicked(row.id)}')
    expect(SRC_CODE).toContain('onClick={() => setPicked(null)}')
  })

  it('the back button is rendered ALWAYS and hidden by the band', () => {
    expect(SRC_CODE).toContain('<button className="st-back" type="button"')
    expect(SRC_CODE).not.toMatch(/isDetail\s*&&\s*\(?\s*<button className="st-back"/)
    expect(CSS_CODE).toMatch(/\.st-back \{ display: none; \}/)
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(phone).toMatch(/\.st-back \{\s*display: inline-flex/)
  })

  it('on a desk the panel always shows something, never a blank', () => {
    // `picked ?? openingSectionId` — and `openingSectionId` is the first section
    // this READER may open, so nobody lands on an empty frame.
    expect(SRC_CODE).toContain('const section = props.sections.find((s) => s.id === shownId) ?? null')
    for (const role of ['オーナー', '店舗管理者', 'スタッフ', '不明', '']) {
      const opening = firstOpenSection(accessFor(role))
      expect({ role, opens: opening?.id ?? null }).not.toEqual({ role, opens: null })
    }
    // The fallback stays as DEFENCE for a future rail whose every row could be
    // gated; it is unreachable by construction today, and that is stated where
    // the branch is rather than asserted as if it ran.
    expect(SRC_CODE).toContain('{props.boundaryFallback}')
    expect(SRC).toContain('UNREACHABLE BY CONSTRUCTION')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ EVERYTHING MOVES — the demo-interaction machinery, run for real', () => {
  const kind = (k: ControlKind) => k
  const seg = kind({ kind: 'segment', options: [{ value: 'a', label: 'ゆったり' }, { value: 'b', label: 'コンパクト' }] })
  const sw = kind({ kind: 'switch', onLabel: '使う', offLabel: '使わない' })
  const chips = kind({ kind: 'chips', options: [{ value: 'app', label: 'アプリ' }, { value: 'mail', label: 'メール' }] })
  const numeric = kind({ kind: 'number', min: 14, max: 365, step: 1, unit: '日' })

  it('a value reads as WORDS, in one home, whatever shape it is', () => {
    expect(labelOfValue(seg, 'b')).toBe('コンパクト')
    expect(labelOfValue(sw, true)).toBe('使う')
    expect(labelOfValue(sw, false)).toBe('使わない')
    expect(labelOfValue(chips, ['app', 'mail'])).toBe('アプリ・メール')
    // ⚠ AN EMPTY CHIP SET SAYS SO. A preview that quietly printed nothing where
    // a choice used to be is a sentence that lies about what is switched on.
    expect(labelOfValue(chips, [])).toBe('なし')
    expect(labelOfValue(numeric, '61')).toBe('61日')
  })

  it('a preview sentence is rewritten by the press that changed the value', () => {
    const template = '同期は{a}、重なったときは{b}です。'
    const first = fillTemplate(template, (id) => (id === 'a' ? '15分ごと' : '新しい方を優先'))
    const after = fillTemplate(template, (id) => (id === 'a' ? '60分ごと' : '新しい方を優先'))
    expect(first).toBe('同期は15分ごと、重なったときは新しい方を優先です。')
    expect(after).not.toBe(first)
    // ⚠ AN UNKNOWN TERM IS LEFT STANDING, NOT BLANKED. A preview that silently
    // dropped a term would be a shorter sentence nobody could tell was wrong.
    expect(fillTemplate('刻みは{missing}です。', () => null)).toBe('刻みは{missing}です。')
  })

  it('a section goes dirty on any control, and clean again when it is put back', () => {
    const section = {
      id: 'demo',
      blocks: [
        {
          id: 'b1',
          title: 't',
          note: '',
          rows: [
            { id: 'r1', label: '刻み', description: '', scopeLabel: null, meta: [], controls: [{ id: 'c1', aria: '刻み', control: seg, value: 'a' }] },
            { id: 'r2', label: '同期', description: '', scopeLabel: null, meta: [], controls: [{ id: 'c2', aria: '同期', control: chips, value: ['app'] }] },
          ],
          facts: [], links: [], list: null, table: null, filterBy: [], preview: null, action: null, audit: null,
        },
      ],
    } as unknown as SettingsSection

    const savedState: Record<string, RowValue> = { c1: 'a', c2: ['app'] }
    expect(sectionDirty(section, { ...savedState }, savedState)).toBe(false)
    expect(sectionDirty(section, { ...savedState, c1: 'b' }, savedState)).toBe(true)
    // ⚠ A CHIP SET COMPARES BY CONTENT. A freshly-built array with the same
    // members must NOT read as a change, or the save button never goes quiet.
    expect(sectionDirty(section, { ...savedState, c2: ['app'] }, savedState)).toBe(false)
    expect(sectionDirty(section, { ...savedState, c2: ['app', 'mail'] }, savedState)).toBe(true)
    // …and putting it back is clean again, which is what makes 保存する honest.
    expect(sectionDirty(section, { c1: 'a', c2: ['app'] }, savedState)).toBe(false)
  })

  it('a required field blocks the save with its OWN name', () => {
    const section = {
      id: 'demo',
      blocks: [
        {
          id: 'b1', title: 't', note: '',
          rows: [{
            id: 'r1', label: '店舗名', description: '', scopeLabel: null, meta: [],
            controls: [{ id: 'c1', aria: '店舗名', control: { kind: 'text', required: true }, value: '銀座店' }],
          }],
          facts: [], links: [], list: null, table: null, filterBy: [], preview: null, action: null, audit: null,
        },
      ],
    } as unknown as SettingsSection
    expect(blockingError(section, { c1: '銀座店' })).toBeNull()
    expect(blockingError(section, { c1: '' })).toBe('店舗名が空欄です — 保存できません。')
    expect(blockingError(section, { c1: '   ' })).toBe('店舗名が空欄です — 保存できません。')
  })

  it('the screen commits a section’s values, and says so — once, per section', () => {
    expect(SRC_CODE).toContain('const commitSection = useCallback((target: SettingsSection) => {')
    expect(SRC_CODE).toContain("setSavedNote((prev) => ({ ...prev, [target.id]: '保存しました（この画面の中だけ）' }))")
    expect(SRC_CODE).toContain('onClick={() => commitSection(section)}')
    // The bar reports exactly one of three states, and the blocking sentence
    // wins — a page that offered 保存する beside 「空欄です」 would be lying.
    expect(SRC_CODE).toContain("{blocked ?? (dirty ? '未保存の変更があります' : savedNote[section.id] ?? '変更はありません')}")
  })

  it('an action refuses an empty required input rather than doing nothing quietly', () => {
    // canon's own raw-string / explicit-empty law on the 書き出し page: zero
    // selections gets a message, never a silent no-op.
    expect(SRC_CODE).toContain("setErrors((prev) => ({ ...prev, [block.id]: action.requireError ?? '入力してください。' }))")
    expect(SRC_CODE).toContain('setResults((prev) => ({ ...prev, [block.id]: fillTemplate(action.template, labelFor) }))')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('自分の表示設定 — the one section that saves outside this screen', () => {
  beforeEach(() => window.localStorage.clear())

  it('a real round-trip through the reader’s own storage', () => {
    const KEY = 'synqedBizDisplayPrefs.v1'
    expect(readPrefs(window.localStorage.getItem(KEY))).toEqual(PREFS_DEFAULT)
    window.localStorage.setItem(KEY, JSON.stringify({ density: 'compact', emphasis: 'strong' }))
    expect(readPrefs(window.localStorage.getItem(KEY))).toEqual({ density: 'compact', emphasis: 'strong' })
    // …and a value from an older shape does not render a state this room has no
    // styles for.
    window.localStorage.setItem(KEY, JSON.stringify({ density: 'huge' }))
    expect(readPrefs(window.localStorage.getItem(KEY))).toEqual(PREFS_DEFAULT)
  })

  it('it writes on the PRESS, and has no save button of its own', () => {
    expect(SRC_CODE).toContain("const PREF_KEY = 'synqedBizDisplayPrefs.v1'")
    expect(SRC_CODE).toContain('window.localStorage.setItem(')
    expect(SRC_CODE).toContain('if (id === DENSITY_ID || id === EMPHASIS_ID) {')
    // ⚠ A PERSONAL PREFERENCE THAT NEEDED COMMITTING would be the page asking
    // permission for something nobody else can see — so the self section renders
    // its own line INSTEAD of the save bar.
    expect(SRC_CODE).toContain("section.persist === 'local' ? (")
    expect(SRC_CODE).toContain('<p className="st-foot">{props.selfSaveLine}</p>')
    // A storage refusal (private mode) is not a reason to break the page.
    expect(SRC_CODE).toMatch(/try \{[\s\S]*?window\.localStorage\.getItem\(PREF_KEY\)[\s\S]*?\} catch/)
  })

  it('the preview really changes SHAPE — the control has a visible effect', () => {
    // ⚖ THE DEAD-LEVER LAW. Every control on this page changes a sentence; this
    // one also changes the geometry of what is under it, which is the effect a
    // density preference is actually about.
    expect(SRC_CODE).toContain('Object.entries(block.preview.attrs ?? {}).map(([attr, id]) => [attr, String(values[id] ?? \'\')])')
    for (const rule of [
      '.st-preview[data-density="compact"] .st-pv-row',
      '.st-preview[data-density="spacious"] .st-pv-row',
      '.st-preview[data-emphasis="subtle"] .st-pv-row',
      '.st-preview[data-emphasis="strong"] .st-pv-row',
    ]) {
      expect({ rule, styled: CSS_CODE.includes(rule) }).toEqual({ rule, styled: true })
    }
  })
})
