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
import { rulebook } from '@/business/lib/fixtures-settings'
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
    // ⚖ S17 STEP 1 — RE-PINNED, AND THE SENTENCE GREW ONE CLAUSE. The row's own
    // words still compose the step; what is new is that the guardrail and the
    // rest now live behind 詳しく, so a row that has them says where they are.
    // A walk that explained a row without mentioning the disclosure holding its
    // guardrail would be teaching half the row.
    expect(SRC_CODE).toContain(
      "data-guide={`${row.description || row.label + 'の設定です。'} ${row.trio?.guardrail ?? ''}${detail.length > 0 ? ' 初期値や決まりは「詳しく」で開けます。' : ''}`.trim()}",
    )
    expect(SRC_CODE).toContain('data-guide-title={block.title}')
    expect(SRC_CODE).toContain('data-guide={block.note || `${block.title}の設定です。`}')
  })

  it('⚖ KEYBOARD REACH — every control this round added is a real button or a real field', () => {
    // ⚠ THE 詳しく DISCLOSURE IS THE ONE THAT MATTERS MOST, because the 初期値 ·
    // guardrail · 業種 · 出どころ lines are BEHIND it: a reader who cannot press
    // it cannot read the guardrail on the dial they are changing. A `span` with
    // an onClick renders identically to a mouse and does not exist to a keyboard.
    expect(SRC_CODE).toMatch(
      /<button\s+type="button"\s+className="st-det-btn"\s+aria-expanded=\{open\}\s+aria-controls=\{detailId\}\s+onClick=\{onToggle\}/,
    )
    // …and the same for the four other new controls, each by its own shape.
    expect(SRC_CODE).toMatch(/<input\s+className="st-search-field"\s+type="search"/)
    expect(SRC_CODE).toContain('aria-label="設定を検索"')
    expect(SRC_CODE).toMatch(/<button\s+className="st-search-clear"\s+type="button"\s+aria-label="検索をクリア"/)
    expect(SRC_CODE).toMatch(/type="button"\s+className=\{`st-jump-item/)
    expect(SRC_CODE).toMatch(/<button\s+className="st-back"\s+type="button"/)
    expect(SRC_CODE).toMatch(/type="button"\s+className="st-coll-del"/)
    // ⚠ AND NOT ONE OF THEM IS A `div`/`span` WEARING AN onClick. The scan is
    // over the whole screen rather than over a list of names, so the next one
    // added the wrong way is caught by the same line. ONE named exception: the
    // tour's dismiss backdrop is a surface rather than a control — there is
    // nothing for a keyboard to land ON, and Escape is what closes the walk
    // (the keydown effect above), so making it focusable would put a tab stop
    // in front of the page for no gain.
    const clickers = [...SRC_CODE.matchAll(/<(div|span)\s+className="([a-z-]+)"[^>]*\sonClick=/g)].map((m) => m[2])
    expect(clickers).toEqual(['st-spot-catch'])
    expect(SRC_CODE).toContain("if (e.key === 'Escape') setTourIdx(-1)")
    // …a disclosure states what it controls and whether it is open, or a screen
    // reader is told there is a button and nothing about what it does.
    expect(SRC_CODE).toContain('aria-expanded={open}')
    expect(SRC_CODE).toContain('aria-controls={detailId}')
    // …and the jump list moves the CARET as well as the page: a control that
    // only scrolls leaves a keyboard reader standing in the list.
    expect(SRC_CODE).toContain("head?.focus({ preventScroll: true })")
    expect(SRC_CODE).toContain('<h3 id={`st-blkh-${block.id}`} tabIndex={-1}>')
  })

  it('⚖ S17 — what 詳しく folds, and the three things it must NOT', () => {
    // ⚠ 1. A LOCKED CONTROL'S REASON DOES NOT FOLD. `RowControl.locked`'s own
    // law is 「the reason is VISIBLE, never a tooltip」, and the whole point of it
    // is that a manager reads it BEFORE they press something that will not move.
    // Everything else behind 詳しく is context they open WHILE changing a dial.
    expect(SRC_CODE).toContain("const lockReasons = row.controls.map((c) => c.locked).filter((r): r is string => r !== undefined)")
    expect(SRC_CODE).toMatch(/\{lockReasons\.map\(\(r\) => \(\s*<p className="st-why" key=\{r\}>\{r\}<\/p>/)
    // …and it is rendered OUTSIDE the disclosure: the reason appears before the
    // `<Collapse>` in the row's own markup.
    const row = SRC_CODE.slice(SRC_CODE.indexOf('className={`st-dial${'), SRC_CODE.indexOf('/** A height that travels'))
    expect(row.indexOf('className="st-why"')).toBeLessThan(row.indexOf('<Collapse open={open}'))
    expect(SRC_CODE).not.toContain("detail.push({ cls: 'st-det-why'")

    // ⚠ 2. A CLOSED PANEL IS CLOSED TO A SCREEN READER TOO. `height: 0` with
    // `overflow: hidden` hides content from EYES and from nobody else — a
    // collapsed disclosure whose body is still in the accessibility tree means
    // four guardrail sentences read aloud for every row of this page, always.
    expect(SRC_CODE).toContain(`data-open={open ? 'true' : 'false'}`)
    expect(CSS_CODE).toMatch(/\.st-det-wrap \{[^}]*visibility: hidden/)
    expect(CSS_CODE).toMatch(/\.st-det-wrap\[data-open="true"\] \{ visibility: visible/)
    // …and the delay is on the way DOWN only, or the height animation would be
    // played to a box that has already vanished.
    expect(CSS_CODE).toMatch(/\.st-det-wrap \{[^}]*transition: visibility 0s linear 260ms/)
    expect(CSS_CODE).toMatch(/\[data-open="true"\] \{ visibility: visible; transition: visibility 0s linear 0s/)

    // ⚠ 3. THE SAVE CARD MOVES ONLY WHEN IT HAS SOMETHING TO SAY. A rise on
    // mount is decoration, and decoration that moves is exactly the motion the
    // Studio standard exists to remove; a rise tied to 「there is unsaved work」
    // is the card speaking.
    expect(SRC_CODE).toContain('spring.current?.set(raised ? -6 : 0)')
    expect(SRC_CODE).toContain('raised={changed > 0}')
    expect(SRC_CODE).toContain('raised={false}')
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
    // ⚖ S17 STEP 1 — RE-PINNED THROUGH `openSection`/`backToList`. Picking is
    // still what opens a section; what the round added is that opening it FROM
    // THE RAIL remembers which row, so 「‹ 設定」 puts the keyboard back on it
    // instead of at the top of a list the reader has to re-find (⚖ keyboard
    // reach). The two calls are the same two facts, with the memory between them.
    expect(SRC_CODE).toContain('onClick={() => onOpen(row.id, true)}')
    expect(SRC_CODE).toContain('if (fromRail) cameFromRef.current = id')
    expect(SRC_CODE).toContain('setPicked(id)')
    expect(SRC_CODE).toContain('setPicked(null)')
    expect(SRC_CODE).toContain('railListRef.current?.querySelector<HTMLButtonElement>(`[data-rail-id="${id}"]`)?.focus()')
  })

  it('the back button is rendered ALWAYS and hidden by the band', () => {
    expect(SRC_CODE).toMatch(/<button\s+className="st-back"\s+type="button"/)
    expect(SRC_CODE).not.toMatch(/isDetail\s*&&\s*\(?\s*<button\s+className="st-back"/)
    expect(CSS_CODE).toMatch(/\.st-back \{ display: none; \}/)
    // ⚖ S17 STEP 1 — the phone band is 899 now, not 743 (see the sheet's ladder:
    // 744-899 left the panel NARROWER than the phone's own full-width section).
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 899px)'))
    expect(phone).toMatch(/\.st-back \{\s*display: inline-flex/)
  })

  it('on a desk the panel always shows something, never a blank', () => {
    // `picked ?? openingSectionId` — and `openingSectionId` is the first section
    // this READER may open, so nobody lands on an empty frame.
    expect(SRC_CODE).toContain('const section = props.sections.find((s) => s.id === shownId) ?? null')
    for (const role of ['オーナー', '店舗管理者', 'スタッフ', '不明', '']) {
      const opening = firstOpenSection(accessFor(role, rulebook))
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
    // ⚖ S17 STEP 1 — RE-PINNED. The note used to be a SENTENCE stored per
    // section (「保存しました（この画面の中だけ）」); the save state now shows a
    // COUNT while there is something to save and a stamped 「保存しました 13:24」
    // after, so what the screen remembers per section is the FACT that it was
    // saved, and the words are composed where they are shown. The parenthetical
    // did not disappear — it is the standing footnote under the same card
    // (`props.demoSaveLine`), which is where it belongs on every section rather
    // than only after a press.
    expect(SRC_CODE).toContain("setCommitted((prev) => ({ ...prev, [target.id]: true }))")
    expect(SRC_CODE).toContain('onClick={() => commitSection(section)}')
    // The state reports exactly one of three things, and the blocking sentence
    // wins — a page that offered 保存する beside 「空欄です」 would be lying.
    expect(SRC_CODE).toContain("{blocked ??")
    expect(SRC_CODE).toContain("`変更 ${changed}件`")
    expect(SRC_CODE).toContain("`✓ 保存しました ${props.saveStampTime}`")
    expect(SRC_CODE).toContain("'変更はありません'")
    // ⚠ AND THE CLOCK IS THE SERVER'S, not the browser's: the room holds no
    // clock and no formatter (the family law), and a `new Date()` here would
    // also make every shot of this page a different picture.
    expect(SRC_CODE).not.toMatch(/new Date\(\)/)
  })

  it('EVERY control shape wires its own change — a shape with no handler is a dead lever', () => {
    // ⚠ THE DEAD-LEVER LAW, AT THE ONE PLACE IT CAN BE READ. Eight shapes, eight
    // wirings: a shape that renders and does not report its change is a control
    // that looks alive and is not, which is the defect the whole round exists to
    // remove. The probe presses all of them in a real browser; this is the pin
    // that fails in jest the day one loses its handler.
    for (const [shape, wiring] of [
      // …and the segment's, for the same reason: `Segment` owns the thumb, and
      // takes the choice back as `onPick`.
      ['segment', 'onPick={locked ? undefined : (v) => onChange(c.id, v)}'],
      ['chips', 'onClick={locked ? undefined : () => onChange(c.id, on ? picked.filter((v) => v !== opt.value) : [...picked, opt.value])}'],
      ['swatch', 'onClick={locked ? undefined : () => onChange(c.id, opt.value)}'],
      // ⚖ S17 STEP 1 — the switch's thumb travels on the room's spring now, so
      // its markup lives in a `Switch` of its own; the WIRING is the same fact,
      // handed down as `onToggle`. `value !== true` rather than `!on` because
      // the component is handed the raw value and decides `on` itself.
      ['switch', 'onToggle={locked ? undefined : () => onChange(c.id, value !== true)}'],
      ['select', 'onChange={locked ? noop : (e) => onChange(c.id, e.target.value)}'],
      ['number commit', 'onBlur={locked ? undefined : (e) => onChange(c.id, String(commitNumber(e.target.value, k.min, k.max)))}'],
    ] as const) {
      expect({ shape, wired: SRC_CODE.includes(wiring) }).toEqual({ shape, wired: true })
    }
    // ⚠ AND THE COUNT IS PART OF THE PIN, BECAUSE THE BATTERY PROVED THE LIST
    // ALONE IS NOT. The segment and the swatch spell their handler identically,
    // so a mutant that killed the SEGMENT's wiring left the swatch's copy behind
    // and this test stayed green — M19 survived on the round's own tip. Nine
    // wirings is the whole vocabulary: segment · chips · swatch · switch ·
    // select · number (change + commit) · time · text. Lose one and the number
    // moves, whichever shape it was.
    // ⚠ AND THE COUNT IS PART OF THE PIN. ⚖ S17 STEP 1 — TEN, not nine: the
    // vocabulary gained `date` (⚖ C2, the 臨時休業 collection's own field, a
    // native `<input type="date">` because that is what the wire's `YYYY-MM-DD`
    // is). Lose one and the number moves, whichever shape it was.
    expect((SRC_CODE.match(/onChange\(c\.id/g) ?? [])).toHaveLength(10)
    // ⚠ A CONTROLLED FIELD ALWAYS GETS AN onChange, EVEN LOCKED. React treats
    // `value` without one as read-only and says so in the console on every
    // render — which the probe's console sweep caught on this round's own tip.
    expect(SRC_CODE).toContain('const noop = () => {}')
    expect(SRC_CODE).not.toMatch(/onChange=\{locked \? undefined/)
  })

  it('the preview is FILLED from the live values, never printed raw', () => {
    // A template printed as it stands would show `{store-hours.booking-step}` to
    // a shop owner — the dead preview and the internal-code leak in one edit.
    expect(SRC_CODE).toContain('{fillTemplate(block.preview.template, labelFor)}')
    expect(SRC_CODE).toContain('return labelOfValue(kind, values[id])')
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
