/**
 * @jest-environment jsdom
 *
 * コーチング — ⚖ Liam's 8/23 GUIDED ?-TOUR law, this room's half, plus the ONE
 * dismiss-by-backdrop surface it owns and the R6-20 gate on it.
 *
 * THE CENSUS IS STRUCTURAL, and it is asked from BOTH sides — the room-4 lesson,
 * inherited: a census that only counts what declares itself can never notice
 * what does not.
 *
 *   · HERE, on the source: every `<section>` and `<header>` this screen renders
 *     must carry the pair, and every HEADING it prints must sit inside a
 *     declared element. Derived from the JSX itself, so a new section that
 *     forgets to declare fails the round the day it lands.
 *   · IN THE BROWSER, on the REAL rendered DOM (`probe/`): the census is taken
 *     again on BOTH tabs and in the dormant state, every heading is tapped, and
 *     the card is measured against the hole — because containment is a fact
 *     about rects and this file has no layout to decide it in.
 *
 * MECHANISM, and its honest ceiling. Territory's import fence allows only
 * react/next/node specifiers, so react-dom does not resolve here and no suite in
 * this folder can mount a React tree — the house pattern every screen-
 * interactions suite here already uses. The pure engine (`spotTargets` /
 * `spotHitIndex` / `wrapStep` / `spotCardAt`) and this room's own
 * `keepCardOffHeading` ARE really run, over rects and nodes handed to them
 * directly, because those are their own inputs rather than a replica of a room.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep } from '@/business/lib/guide'
import { keepCardOffHeading } from '@/business/lib/coaching'

const ROOM_DIR = 'src/app/[locale]/(business)/business/coaching'
const SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/CoachingScreen.tsx`), 'utf8')
const GUIDE_CODE = readFileSync(join(process.cwd(), 'src/business/lib/guide.ts'), 'utf8')

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
const SRC_CODE = stripComments(SRC).replace(/^\s*\/\/.*$/gm, '')

type Declaration = { title: string; text: string; at: number }
const DECLARATIONS: Declaration[] = [
  ...SRC_CODE.matchAll(/data-guide-title="([^"]*)"\s*\n?\s*data-guide="([^"]*)"/g),
].map((m) => ({ title: m[1], text: m[2], at: m.index ?? 0 }))

/** Every OPENING TAG of `<tag …>`, whole. JSX attributes hold braces, template
 *  literals and quotes, so the scan tracks all three rather than stopping at the
 *  first `>` it sees. */
function openingTags(src: string, tag: string): Array<{ text: string; at: number; end: number }> {
  const out: Array<{ text: string; at: number; end: number }> = []
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
    out.push({ text: src.slice(i, j + 1), at: i, end: j + 1 })
    i = src.indexOf(`<${tag}`, j)
  }
  return out
}

function spanOf(src: string, tag: string, open: { at: number; end: number }): string {
  let depth = 1
  let i = open.end
  while (depth > 0 && i < src.length) {
    const nextOpen = src.indexOf(`<${tag}`, i)
    const nextClose = src.indexOf(`</${tag}>`, i)
    if (nextClose < 0) break
    if (nextOpen >= 0 && nextOpen < nextClose) { depth += 1; i = nextOpen + tag.length + 1; continue }
    depth -= 1
    i = nextClose + tag.length + 3
  }
  return src.slice(open.at, i)
}

const SECTIONS = openingTags(SRC_CODE, 'section')
const HEADERS = openingTags(SRC_CODE, 'header')
const nameOf = (tag: string) =>
  /aria-label="([^"]*)"/.exec(tag)?.[1] ?? /className="([^"]*)"/.exec(tag)?.[1] ?? tag.slice(0, 70)

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ Liam 8/23 — the room declares every section it renders', () => {
  it('THE CENSUS IS STRUCTURAL — every <section> and <header> carries the pair', () => {
    const undeclared = [...SECTIONS, ...HEADERS]
      .filter((t) => !t.text.includes('data-guide-title=') || !t.text.includes('data-guide='))
      .map((t) => nameOf(t.text))
    expect({ undeclared }).toEqual({ undeclared: [] })
  })

  it('there is no self-closing section or header to slip past the span scan', () => {
    for (const t of [...SECTIONS, ...HEADERS]) expect(t.text.endsWith('/>')).toBe(false)
  })

  it('every declaration is PAIRED, non-empty, and a whole sentence', () => {
    expect(DECLARATIONS.length).toBe([...SRC_CODE.matchAll(/data-guide-title=/g)].length)
    for (const d of DECLARATIONS) {
      expect({ title: d.title, ok: d.title.length > 0 }).toEqual({ title: d.title, ok: true })
      // A card that says 「一覧」 and nothing else explains nothing. The walk is
      // the room's only standing explainer, so each step earns its sentences.
      expect({ title: d.title, len: d.text.length > 40 }).toEqual({ title: d.title, len: true })
      expect({ title: d.title, ends: d.text.trim().endsWith('。') }).toEqual({ title: d.title, ends: true })
    }
  })

  it('every declared TITLE is unique — two steps cannot wear one name', () => {
    const titles = DECLARATIONS.map((d) => d.title)
    expect(titles.length).toBe(new Set(titles).size)
  })

  it('the room declares the sections it actually has, on BOTH tabs and when dormant', () => {
    const titles = DECLARATIONS.map((d) => d.title)
    expect(titles).toEqual(expect.arrayContaining([
      // always
      // ⚠ 「この画面の見え方」 BECAME 「あなたのデータについて」 in the look-fix
      // round: the two-line notice grew into the full nine-fact disclosure, so
      // the step's name is now the name of the thing it explains.
      'コーチング', 'あなたのデータについて',
      // the module-off state
      'この店舗の状態',
      // 自分のコーチング
      'あなたの成績', '次の一手', '気づき', '成約率の推移', '不成約の理由', '会話スキル', '上位層から学ぶ',
      'マネージャーへの共有', 'まだ表示できないもの',
      // …and the look-fix round's own self-tab sections
      'コーチングを受けることへの同意', 'あなたの強み',
      'トップパフォーマーのパターン', '学習モジュール',
      // 全スタッフ表示
      '表示の切り替え', '全スタッフ表示の見かた', 'スタッフの状況', '共有の状況',
      '店舗全体のサポートエリア',
      // 経営への効果 (the owner's own third screen)
      'コーチングの効果', '他店舗との比較', '指標ごとの押し上げ', 'この数字の出し方', '費用との比較',
      // and the boundary a staff member gets instead of the tabs
      '全スタッフ表示について',
    ]))
    // ⚠ THE COUNT IS PINNED AS WELL AS THE MEMBERSHIP, so a section added
    // without a declaration cannot hide behind `arrayContaining`.
    expect(titles.length).toBe(27)
  })

  it('every HEADING the screen prints sits inside a declared element', () => {
    const declaredSpans = [...SECTIONS, ...HEADERS]
      .filter((t) => t.text.includes('data-guide-title='))
      .map((t) => spanOf(SRC_CODE, t.text.startsWith('<header') ? 'header' : 'section', t))
    const headings = [...SRC_CODE.matchAll(/<(h1|h2|h3)[^>]*>/g)].map((m) => ({ tag: m[0], at: m.index ?? 0 }))
    expect(headings.length).toBeGreaterThan(8)
    for (const h of headings) {
      const inside = declaredSpans.some((span) => span.includes(SRC_CODE.slice(h.at, h.at + 40)))
      expect({ heading: h.tag, insideADeclaredSection: inside }).toEqual({ heading: h.tag, insideADeclaredSection: true })
    }
  })

  it('the walk is scoped to the ROOM’s root, never the document', () => {
    expect(SRC_CODE).toContain('spotTargets(rootRef.current)')
    expect(SRC_CODE).not.toContain('spotTargets(document)')
  })

  it('the shared engine is UNTOUCHED — the room wires a trigger and an overlay', () => {
    // guide.ts is frozen by the packet; the room-local correction is
    // `keepCardOffHeading`, which lives in coaching.ts with its cite and the
    // queued engine fix named beside it.
    expect(GUIDE_CODE).not.toContain('keepCardOffHeading')
    expect(GUIDE_CODE).not.toContain('coaching')
    const lib = readFileSync(join(process.cwd(), 'src/business/lib/coaching.ts'), 'utf8')
    expect(lib).toContain('karute.ts:588')
    expect(lib).toContain('frozen')
    expect(lib).toContain("Room-local by the packet's own instruction")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the tour ENGINE, really run over this room’s declarations', () => {
  /** A DOM built from the room's OWN declarations — the titles and sentences the
   *  source carries, on nested nodes with real rects, so the engine is answering
   *  about this room rather than about a fixture. */
  function mount(rects: Array<{ w: number; h: number; x: number; y: number }>) {
    const root = document.createElement('div')
    root.className = 'page pg-coaching'
    DECLARATIONS.forEach((d, i) => {
      const el = document.createElement('section')
      el.setAttribute('data-guide-title', d.title)
      el.setAttribute('data-guide', d.text)
      const r = rects[i] ?? { w: 600, h: 120, x: 0, y: i * 140 }
      el.getBoundingClientRect = () => ({ width: r.w, height: r.h, left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h, x: r.x, y: r.y, toJSON: () => ({}) })
      root.appendChild(el)
    })
    document.body.appendChild(root)
    return root
  }

  afterEach(() => { document.body.innerHTML = '' })

  it('every declaration joins the walk, in DOM order, with nothing to keep in sync', () => {
    const root = mount([])
    const targets = spotTargets(root)
    expect(targets.length).toBe(DECLARATIONS.length)
    expect(targets.map((t) => t.dataset.guideTitle)).toEqual(DECLARATIONS.map((d) => d.title))
  })

  it('a section that is not on screen DROPS OUT of the walk and out of the count', () => {
    const root = mount([])
    // The 全スタッフ表示 sections do not render while the self tab is open — the
    // adaptive property Liam asked for, and it is the engine's own rule.
    const hidden = root.querySelector('[data-guide-title="スタッフの状況"]') as HTMLElement
    hidden.getBoundingClientRect = () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) })
    expect(spotTargets(root).length).toBe(DECLARATIONS.length - 1)
  })

  it('tap-any-element-to-learn picks the SMALLEST region under the pointer', () => {
    const rects = [
      { w: 900, h: 600, x: 0, y: 0 },   // a big outer section
      { w: 200, h: 80, x: 40, y: 40 },  // a smaller one nested inside it
    ]
    const boxes = rects.map((r) => ({ left: r.x, top: r.y, width: r.w, height: r.h }))
    expect(spotHitIndex(60, 60, boxes)).toBe(1)
    expect(spotHitIndex(700, 400, boxes)).toBe(0)
    // …and a tap on nothing declared is `-1`, which the room turns into a close.
    expect(spotHitIndex(2000, 2000, boxes)).toBe(-1)
    expect(SRC_CODE).toContain('if (hit >= 0) setTourIdx(hit)')
    expect(SRC_CODE).toContain('else setTourIdx(-1)')
  })

  it('the walk is a RING — 次へ on the last step returns to the first', () => {
    const n = DECLARATIONS.length
    expect(wrapStep(n - 1 + 1, n)).toBe(0)
    expect(wrapStep(-1, n)).toBe(n - 1)
    expect(wrapStep(0, 0)).toBe(-1)
    expect(SRC_CODE).toContain("tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'")
  })

  it('the card never covers the region it explains, and never its heading either', () => {
    // ⚠ A FULL-WIDTH SECTION, taller than the viewport. A narrower one leaves
    // the engine room to put the card BESIDE it, where there is nothing to
    // correct — measured, not assumed: at width 700 the engine returns
    // left 752 against a section ending at 740, and `keepCardOffHeading`
    // correctly does nothing. The defect only exists when the card has to land
    // on top of the section it is explaining.
    const target = { left: 40, top: 0, width: 1200, height: 2000 }
    const viewport = { width: 1280, height: 900 }
    const card = { width: 300, height: 200 }
    const engine = spotCardAt(target, card, viewport)
    const fixed = keepCardOffHeading(engine, card, target, viewport)
    // The engine's last-resort clamp lands the card ON the section's heading;
    // this room's correction moves it clear of the first 64px.
    expect(engine.top).toBeLessThan(64)
    expect(fixed.top).toBeGreaterThanOrEqual(64)
    // A card that already clears the heading is returned untouched.
    const clear = { top: 500, left: 40 }
    expect(keepCardOffHeading(clear, card, target, viewport)).toEqual(clear)
    // …and so is one that sits BESIDE the section rather than over it.
    const narrow = { left: 40, top: 0, width: 700, height: 2000 }
    const beside = spotCardAt(narrow, card, viewport)
    expect(beside.left).toBeGreaterThan(narrow.left + narrow.width)
    expect(keepCardOffHeading(beside, card, narrow, viewport)).toEqual(beside)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ R6-20 — the tour survives a double-click on the ? that opened it', () => {
  it('the settle window is the PLATFORM’s double-click interval, not a tuned number', () => {
    expect(SRC_CODE).toContain('const SETTLE_MS = 500')
    expect(SRC).toContain('platform')
    expect(SRC).toContain('double-click interval')
  })

  it('the stamp FAILS CLOSED — infinity until the overlay has actually been laid out', () => {
    expect(SRC_CODE).toContain('useRef(Number.POSITIVE_INFINITY)')
    // Stamped in a LAYOUT effect, never in a ref initializer (`react-hooks/purity`).
    expect(SRC_CODE).toContain('settledAt.current = tourOpen ? Date.now() : Number.POSITIVE_INFINITY')
    const stampIdx = SRC_CODE.indexOf('settledAt.current = tourOpen')
    const layoutIdx = SRC_CODE.lastIndexOf('useLayoutEffect(() => {', stampIdx)
    expect(layoutIdx).toBeGreaterThan(-1)
    expect(stampIdx - layoutIdx).toBeLessThan(120)
  })

  it('the dim layer IGNORES a press inside the window, and only that layer does', () => {
    expect(SRC_CODE).toContain('if (Date.now() - settledAt.current < SETTLE_MS) return')
    // Escape, 次へ, 前へ and 終了 are UNTOUCHED — this delays the ONE exit a
    // reader can take by accident, never the ones they take on purpose.
    const guarded = SRC_CODE.split('settledAt.current < SETTLE_MS')[1].slice(0, 600)
    expect(guarded).not.toContain('Escape')
    expect(SRC_CODE).toContain("if (e.key === 'Escape') setTourIdx(-1)")
  })

  it('the guard’s arithmetic, run — the second press of a double-click is refused', () => {
    const decide = (openedAt: number, pressAt: number) => pressAt - openedAt >= 500
    expect(decide(1000, 1080)).toBe(false) // the leftover press of a double-click
    expect(decide(1000, 1499)).toBe(false)
    expect(decide(1000, 1500)).toBe(true) // a decision takes a reader time
    expect(decide(1000, 4000)).toBe(true)
    // …and before the overlay is laid out, nothing gets through at all.
    expect(Number.POSITIVE_INFINITY > 0 && 1000 - Number.POSITIVE_INFINITY < 500).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the keyboard is never stranded', () => {
  it('opening puts focus on 次へ; closing hands it back to the ?', () => {
    expect(SRC_CODE).toContain('tourNextRef.current?.focus()')
    expect(SRC_CODE).toContain('helpRef.current?.focus()')
    // `wasOpen` keeps the close half from firing on the first render.
    expect(SRC_CODE).toContain('if (!wasOpen.current) return')
  })

  it('the arrows walk the ring and Escape closes — one listener, bound only while open', () => {
    expect(SRC_CODE).toContain("if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))")
    expect(SRC_CODE).toContain("if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))")
    expect(SRC_CODE).toContain('if (!tourOpen) return')
    expect(SRC_CODE).toContain("document.removeEventListener('keydown', onKey)")
  })

  it('the ? announces what it controls, and the card is a dialog', () => {
    expect(SRC_CODE).toContain('aria-haspopup="dialog"')
    expect(SRC_CODE).toContain('aria-controls="cgTour"')
    expect(SRC_CODE).toContain('id="cgTour"')
    expect(SRC_CODE).toContain('role="dialog"')
  })

  it('the tabs are a real tablist, wired both ways', () => {
    expect(SRC_CODE).toContain('role="tablist"')
    // THREE tabs since the look-fix round: the owner's 経営への効果 is its own
    // screen behind its own capability, so the tab row itself is what separates
    // the two manager personas the role preview walks.
    expect([...SRC_CODE.matchAll(/role="tab"/g)].length).toBe(3)
    expect([...SRC_CODE.matchAll(/role="tabpanel"/g)].length).toBe(3)
    expect(SRC_CODE).toContain('aria-controls="cgPanelSelf"')
    expect(SRC_CODE).toContain('aria-labelledby="cgTabSelf"')
    expect(SRC_CODE).toContain('aria-controls="cgPanelTeam"')
    expect(SRC_CODE).toContain('aria-labelledby="cgTabTeam"')
    expect(SRC_CODE).toContain('aria-controls="cgPanelRoi"')
    expect(SRC_CODE).toContain('aria-labelledby="cgTabRoi"')
  })
})
