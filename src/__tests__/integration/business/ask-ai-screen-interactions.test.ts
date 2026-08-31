/**
 * @jest-environment jsdom
 *
 * AI相談 — ⚖ Liam's 8/23 GUIDED ?-TOUR law, this room's half, plus the room's
 * own band and control pins.
 *
 * THE LAW: every Business page ships the 画面の説明 tour in the 今日の運営 style
 * — a ? trigger, a spotlight walk of the page's sections in visual order, and
 * tap-any-element-to-learn during the walk. Sections SELF-REGISTER by declaring
 * `data-guide` + `data-guide-title` on themselves, so anything that renders is
 * explained and anything hidden drops out.
 *
 * THE CENSUS IS STRUCTURAL, and it is asked from BOTH sides — the room-4 lesson,
 * inherited: a census that only counts what declares itself can never notice
 * what does not.
 *
 *   · HERE, on the source: every `<section>` and every `<header>` this screen
 *     renders must carry the pair, and every HEADING it prints must sit inside a
 *     declared element. Derived from the JSX itself — there is no list to keep
 *     in sync, and a new section that forgets to declare fails the round the day
 *     it lands.
 *   · IN THE BROWSER, on the REAL rendered DOM (`probe/`): the census is taken
 *     again, every heading is TAPPED, and the card is measured against the hole.
 *     That is where containment is decided, because containment is a fact about
 *     rects and this file has no layout to decide it in.
 *
 * MECHANISM, and its honest ceiling. Territory's import fence allows only
 * react/next/node specifiers, so react-dom does not resolve here and no suite in
 * this folder can mount a React tree — the house pattern every screen-
 * interactions suite here already uses. The pure engine (`spotTargets` /
 * `spotHitIndex` / `wrapStep` / `spotCardAt`) IS really run, over rects and
 * nodes it is handed directly, because those are the engine's own inputs rather
 * than a replica of this room.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep } from '@/business/lib/guide'

const ROOM_DIR = 'src/app/[locale]/(business)/business/ask-ai'
const SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/AskAiScreen.tsx`), 'utf8')
const CSS = readFileSync(join(process.cwd(), `${ROOM_DIR}/ask-ai.css`), 'utf8')
/** The SHARED engine, read whole: the room wires its own trigger and overlay to
 *  it, and the engine's contract for every other room is unchanged by this one. */
const GUIDE_CODE = readFileSync(join(process.cwd(), 'src/business/lib/guide.ts'), 'utf8')

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
const SRC_CODE = stripComments(SRC).replace(/^\s*\/\/.*$/gm, '')
const CSS_CODE = stripComments(CSS)

type Declaration = { title: string; text: string; at: number }
const DECLARATIONS: Declaration[] = [
  ...SRC_CODE.matchAll(/data-guide-title="([^"]*)"\s*\n\s*data-guide="([^"]*)"/g),
].map((m) => ({ title: m[1], text: m[2], at: m.index ?? 0 }))

/** Every OPENING TAG of `<tag …>` in the source, whole. JSX attributes hold
 *  braces, template literals and quotes, so the scan tracks all three rather
 *  than stopping at the first `>` it sees. */
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

/** The source span of the element opened at `open`, found by counting its own
 *  opening and closing tags. */
function spanOf(src: string, tag: string, open: { at: number; end: number }): { start: number; end: number } {
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
  return { start: open.at, end: i }
}

const SECTIONS = openingTags(SRC_CODE, 'section')
const HEADERS = openingTags(SRC_CODE, 'header')
const DECLARED = [...SECTIONS, ...HEADERS].filter((t) => t.text.includes('data-guide-title='))

const nameOf = (tag: string) =>
  /aria-label(?:ledby)?="([^"]*)"/.exec(tag)?.[1] ?? /className="([^"]*)"/.exec(tag)?.[1] ?? tag.slice(0, 70)

// ═══════════════════════════════════════════════════════════════════════════
describe('⚖ Liam 8/23 — the room declares every section it renders', () => {
  it('THE CENSUS IS STRUCTURAL — every <section> and <header> carries the pair', () => {
    const undeclared = [...SECTIONS, ...HEADERS]
      .filter((t) => !t.text.includes('data-guide-title=') || !t.text.includes('data-guide='))
      .map((t) => nameOf(t.text))
    expect({ undeclared }).toEqual({ undeclared: [] })
    // …and there are enough of them for the pin to be worth anything.
    expect(DECLARED.length).toBeGreaterThanOrEqual(9)
  })

  it('there is no self-closing section or header to slip past the span scan', () => {
    for (const t of [...SECTIONS, ...HEADERS]) expect(t.text.endsWith('/>')).toBe(false)
  })

  it('every declaration is PAIRED, non-empty, and a whole sentence', () => {
    expect(DECLARATIONS.length).toBe([...SRC_CODE.matchAll(/data-guide-title=/g)].length)
    for (const d of DECLARATIONS) {
      expect({ title: d.title, ok: d.title.length > 0 }).toEqual({ title: d.title, ok: true })
      // A card that says 「会話」 and nothing else explains nothing. The walk is
      // the room's only standing explainer, so each step earns its own sentences.
      expect({ title: d.title, len: d.text.length > 40 }).toEqual({ title: d.title, len: true })
      expect({ title: d.title, ends: d.text.trim().endsWith('。') }).toEqual({ title: d.title, ends: true })
    }
  })

  it('no two sections claim the same title — a reader must know which one they are on', () => {
    const titles = DECLARATIONS.map((d) => d.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('the room’s own census, by name — a new section fails this the day it lands', () => {
    expect(DECLARATIONS.map((d) => d.title).sort()).toEqual([
      'AI相談',
      'AIが提案する次のアクション',
      'さらに表示',
      'この画面の値の設定元',
      'この画面の見え方',
      'じっくり相談',
      '今日のヒント',
      '会話',
      '接続済みデータ',
      '業種の設定',
      '質問を入力',
    ].sort())
  })

  it('the CONDITIONAL sections declare too — they are the ones the walk drops', () => {
    // 今日のヒント in a store with no signals, 業種の設定 in a shop that has chosen
    // one, この画面の見え方 for a reader who has the permission, さらに表示 in a store
    // whose whole feed already fits: each renders behind a guard, and each
    // declares, so the walk's N/M shrinks and grows by itself.
    for (const title of ['今日のヒント', '業種の設定', 'この画面の見え方', 'さらに表示']) {
      expect(DECLARATIONS.map((d) => d.title)).toContain(title)
    }
    for (const guard of ['props.signals.length > 0 &&', 'props.profileHint &&', 'denied &&', 'walk.moreLabel &&']) {
      expect(SRC_CODE).toContain(guard)
    }
  })

  it('EVERY HEADING THE PAGE PRINTS SITS INSIDE A DECLARED ELEMENT', () => {
    // A reader taps the WORD — 会話, じっくり相談 — because it is the thing they
    // are asking about. A declaration on the box alone leaves that word a few
    // pixels outside the rect, so the tap lands on the scrim and CLOSES the walk.
    const spans = DECLARED.map((t) => spanOf(SRC_CODE, SECTIONS.includes(t) ? 'section' : 'header', t))
    // ⚠ THE BOUNDARY PANEL IS EXCLUDED, AND ARGUED. It is present-but-inert —
    // `hidden` + `aria-hidden`, one mount, canon's own entitlement copy — so it
    // has no box, and the engine's registry drops a node with no box by itself
    // (`spotTargets` filters on `getBoundingClientRect`). Declaring it would put
    // a step in the walk that can never be reached.
    const boundaryAt = SRC_CODE.indexOf('className="ak-boundary"')
    // …to its LAST line rather than its first `</div>`: the panel's own eyebrow
    // is a div, so the first close is nine characters in and the exclusion would
    // cover nothing (a pin that can be true for a second reason — the M10
    // lesson, caught in my own read of this file).
    const boundaryEnd = SRC_CODE.indexOf('{props.boundary.backLabel}')
    expect(boundaryAt).toBeGreaterThan(0)
    expect(boundaryEnd).toBeGreaterThan(boundaryAt)
    const headings = [
      ...[...SRC_CODE.matchAll(/<h1[\s>]/g)].map((m) => ({ what: 'h1', at: m.index ?? 0 })),
      ...[...SRC_CODE.matchAll(/<h2[\s>]/g)].map((m) => ({ what: 'h2', at: m.index ?? 0 })),
      ...[...SRC_CODE.matchAll(/className="ak-sec-title"/g)].map((m) => ({ what: 'ak-sec-title', at: m.index ?? 0 })),
    ].filter((h) => !(h.at > boundaryAt && h.at < boundaryEnd))
    expect(headings.length).toBeGreaterThan(4)
    const orphans = headings
      .filter((h) => !spans.some((s) => h.at > s.start && h.at < s.end))
      .map((h) => `${h.what}@${h.at}`)
    expect({ orphans }).toEqual({ orphans: [] })
  })

  it('the layout wrappers declare NOTHING, deliberately — they hold no content of their own', () => {
    // `.ak-workspace` / `.ak-main` / `.ak-aside` exist to place the two zones.
    // A step on one of them would spotlight a column and explain the column,
    // which is a fact about the CSS rather than about the shop's work; the
    // sections inside them are what a reader is actually asking about.
    for (const wrapper of ['ak-workspace', 'ak-main', 'ak-aside']) {
      const at = SRC_CODE.indexOf(`className="${wrapper}"`)
      expect({ wrapper, found: at > 0 }).toEqual({ wrapper, found: true })
      const tagEnd = SRC_CODE.indexOf('>', at)
      expect({ wrapper, declares: SRC_CODE.slice(at, tagEnd).includes('data-guide') })
        .toEqual({ wrapper, declares: false })
    }
  })

  it('the trigger and the overlay are wired to the FROZEN shared engine', () => {
    expect(SRC_CODE).toContain("from '@/business/lib/guide'")
    for (const fn of ['spotCardAt', 'spotHitIndex', 'spotTargets', 'wrapStep']) {
      expect(SRC_CODE).toContain(fn)
    }
    // The engine is a SHARED home — this room adds nothing to it and renames
    // nothing in it (the カルテ room's own placement correction was copied into
    // this room's lib rather than pushed into the engine, argued there).
    expect(GUIDE_CODE).not.toContain('ask-ai')
    expect(GUIDE_CODE).not.toContain('ak-')
    // The ? is a hairline circle that lights for the whole walk, never a filled
    // one (⚖ R13).
    expect(SRC_CODE).toContain('aria-expanded={tourOpen}')
    expect(SRC_CODE).toContain('aria-controls="akTour"')
    expect(CSS_CODE).toContain('.biz .pg-ask-ai .ak-help[aria-expanded="true"]')
    // Four layers, and every one is the room's own `ak-` name (今日の運営 owns
    // `.biz .spot-*` bare — the ⚖ sibling-sheet fence's own worked example).
    for (const layer of ['ak-spot-catch', 'ak-spot-hover', 'ak-spot-hole', 'ak-spot-card']) {
      expect(SRC_CODE).toContain(`className="${layer}"`)
      expect(CSS_CODE).toContain(`.biz .pg-ask-ai .${layer}`)
    }
  })

  it('the engine really walks THIS room’s declarations, on real nodes', () => {
    // jsdom does no layout, so every rect is zero — the engine's own filter
    // would drop them all. The nodes are given a measurable box explicitly, so
    // what is exercised is the REGISTRY and the HIT TEST, not a stub of them.
    document.body.innerHTML = DECLARATIONS.map(
      (d, i) => `<section id="s${i}" data-guide-title="${d.title}" data-guide="x"></section>`,
    ).join('')
    const boxes = DECLARATIONS.map((_, i) => ({ left: 0, top: i * 100, width: 400, height: 90 }))
    DECLARATIONS.forEach((_, i) => {
      const el = document.getElementById(`s${i}`)!
      el.getBoundingClientRect = () => ({ ...boxes[i], right: 400, bottom: i * 100 + 90, x: 0, y: i * 100, toJSON: () => ({}) })
    })
    const targets = spotTargets(document)
    expect(targets).toHaveLength(DECLARATIONS.length)
    expect(targets.map((t) => t.dataset.guideTitle)).toEqual(DECLARATIONS.map((d) => d.title))
    // tap-any-element-to-learn: a point inside step 3's box selects step 3.
    expect(spotHitIndex(10, 320, boxes)).toBe(3)
    // …and a tap on nothing declared is -1, which is what closes the walk.
    expect(spotHitIndex(900, 320, boxes)).toBe(-1)
    // the walk is a RING
    expect(wrapStep(DECLARATIONS.length, DECLARATIONS.length)).toBe(0)
    expect(wrapStep(-1, DECLARATIONS.length)).toBe(DECLARATIONS.length - 1)
    // and the card never covers the region it is explaining
    const at = spotCardAt(boxes[0], { width: 300, height: 160 }, { width: 1280, height: 800 })
    expect(at.top).toBeGreaterThanOrEqual(boxes[0].top + boxes[0].height)
  })
})

describe('the room’s controls — every one has a visible effect', () => {
  it('送信 is pressable when there is a question, and refuses when pressed', () => {
    // ⚖ THE DEAD-LEVER SWEEP's source half: a control whose only outcome is
    // nothing fails the room. 送信 is `disabled` ONLY on an empty box (the
    // phone's own contract) — never `aria-disabled` with no handler, which would
    // be a refusal nobody can read.
    expect(SRC_CODE).toContain("disabled={draft.trim() === ''}")
    expect(SRC_CODE).toContain('onClick={() => refuseSend()}')
  })

  it('every pressable control in the room carries a handler', () => {
    const buttons = openingTags(SRC_CODE, 'button')
    expect(buttons.length).toBeGreaterThan(6)
    const dead = buttons.filter((b) => !b.text.includes('onClick=')).map((b) => nameOf(b.text))
    expect({ dead }).toEqual({ dead: [] })
  })

  it('却下 removes the card and says out loud that nothing was saved', () => {
    expect(SRC_CODE).toContain('onClick={() => dismiss(c.id)}')
    expect(SRC_CODE).toContain('const visible = props.feed.filter((c) => !dismissed.includes(c.id))')
    expect(SRC_CODE).toContain('showToast(props.dismissToast)')
    // …and the count above the list is the VISIBLE count, so a dismissal moves
    // the number a reader is looking at (one call, rendered twice — ⚖ A8).
    expect(SRC_CODE).toContain('提案 {visible.length}件')
  })

  it('⚖ THE FEED IS WINDOWED, and the head’s count is still the TOTAL', () => {
    // L4-2. The window is browsing state like the dismissed list, taken off the
    // list the reader can still SEE — so 「提案 N件」 above and 「残り M件」 below
    // are two readings of one call and can never describe two lists.
    expect(SRC_CODE).toContain('const [feedSteps, setFeedSteps] = useState(1)')
    expect(SRC_CODE).toContain('const walk = windowFeed(visible, feedSteps)')
    expect(SRC_CODE).toContain('{walk.shown.map((c) => (')
    // the head counts the TOTAL, never the window — the two must not agree by
    // being the same expression
    expect(SRC_CODE).toContain('提案 {visible.length}件')
    expect(SRC_CODE).not.toContain('提案 {walk.shown.length}件')
    // the control's own label is DERIVED in the lib beside the arithmetic; this
    // file states no count of its own
    expect(SRC_CODE).toContain('{walk.moreLabel}')
    expect(SRC_CODE).not.toMatch(/さらに表示（残り/)
    expect(SRC_CODE).toContain('onClick={() => setFeedSteps((s) => s + 1)}')
    // …and the band is the カルテ room's own footer shape, with no scroller and
    // no height cap anywhere near it (⚖ page-scroll: the WINDOW shortens the
    // page, it does not put an axis on a box).
    expect(CSS_CODE).toContain('.biz .pg-ask-ai .ak-more {')
    expect(CSS_CODE).not.toMatch(/\.ak-more[^{]*\{[^}]*(overflow|max-height)/)
  })

  it('the 設定する CTA refuses to its own registry line, and it is reachable', () => {
    // `aria-disabled` rather than `disabled`: the control stays focusable so its
    // reason is reachable by keyboard and screen reader, and the reason rides the
    // ACCESSIBLE NAME as well as the title (a screen reader drops `title`).
    expect(SRC_CODE).toContain('aria-disabled="true"')
    expect(SRC_CODE).toContain('title={props.refusals.settings}')
    expect(SRC_CODE).toContain('aria-label={`${props.profileHint.cta} — ${props.refusals.settings}`}')
    expect(SRC_CODE).toContain('onClick={() => setRefusal({ reason: props.refusals.settings, contextLabel: null })}')
  })

  it('the tour hands the keyboard back, and owns Escape only while it is open', () => {
    expect(SRC_CODE).toContain('if (!tourOpen) return')
    expect(SRC_CODE).toContain("if (e.key === 'Escape') setTourIdx(-1)")
    expect(SRC_CODE).toContain('tourNextRef.current?.focus()')
    expect(SRC_CODE).toContain('helpRef.current?.focus()')
    // …and the composer's Enter is a LOCAL handler, so one press can never both
    // send and close the walk.
    expect(SRC_CODE).toContain('onKeyDown={onComposerKey}')
  })

  it('the toast timer is cleared when the screen goes away', () => {
    expect(SRC_CODE).toContain('if (toastTimer.current) clearTimeout(toastTimer.current)')
    expect(SRC_CODE).toContain('useEffect(() => () => {')
  })
})

describe('⚖ ALL-SCREEN ADAPTIVITY — the ladder is declared, band by band', () => {
  const bands = [...CSS_CODE.matchAll(/@media ([^{]+)\{/g)].map((m) => m[1].trim())

  it('every required band has a rule of its own', () => {
    expect(bands).toEqual([
      '(min-width: 1400px)',
      '(max-width: 1279px)',
      '(max-width: 1099px)',
      '(max-width: 1023px)',
      '(min-width: 800px) and (max-width: 1023px)',
      '(max-width: 743px)',
      '(prefers-reduced-motion: reduce)',
    ])
  })

  it('the two zones stack at ≤1023, consultation FIRST', () => {
    expect(CSS_CODE).toMatch(/@media \(max-width: 1023px\) \{[\s\S]*?\.ak-workspace \{ grid-template-columns: minmax\(0, 1fr\)/)
    // The stack order is the DOM order — the consultation is the titular
    // function and is written first, so no `order:` rule exists to drift.
    expect(CSS_CODE).not.toMatch(/\border\s*:\s*-?\d/)
    expect(SRC_CODE.indexOf('className="ak-main"')).toBeLessThan(SRC_CODE.indexOf('className="ak-aside"'))
    // …and inside the aside, the feed is above the trace card.
    expect(SRC_CODE.indexOf('className="ak-feed"')).toBeLessThan(SRC_CODE.indexOf('className="ak-trace"'))
  })

  it('≤743 raises every interactive control to ≥44px, swept flat', () => {
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    for (const sel of ['.ak-send', '.ak-open', '.ak-dismiss', '.ak-signal', '.ak-tpl', '.ak-profile-cta', '.ak-spot-foot button', '.btn']) {
      expect({ sel, raised: new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{[^}]*min-height: 4[46]px`).test(phone) })
        .toEqual({ sel, raised: true })
    }
    // …and the ? keeps its 22px PAINT and grows its HIT BOX instead.
    expect(phone).toContain('.biz .pg-ask-ai .ak-help::after')
  })

  it('⚖ the composer is NOT sticky — it rides the page flow at every width', () => {
    expect(CSS_CODE).not.toMatch(/position:\s*sticky/)
    expect(CSS_CODE).not.toMatch(/position:\s*fixed[^}]*bottom:\s*0/)
  })

  it('reduced motion is honoured, and nothing in the nav blinks', () => {
    expect(CSS_CODE).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?transition: none/)
    // The only animated thing in the room is the spotlight sliding between
    // steps; there is no keyframe here at all, so no "quietly live" breathe and
    // no blink to disable.
    expect(CSS_CODE).not.toContain('@keyframes')
    expect(CSS_CODE).not.toMatch(/animation:/)
  })

  it('the room joins the shell’s 1180px floor opt-in list, and only the SHELL states it', () => {
    // ⚠ EVERY BAND BELOW 1180 IN THIS FILE STANDS ON THIS ONE SHELL LINE. The
    // family default is `.biz .app { min-width: 1180px }` and a room without a
    // measured ladder PANS below it; this room's selector is on the opt-in list
    // because probe build1–3 measured its ladder at every band in both rail
    // states. Struck out of that line, 390 renders a 1180px page and the whole
    // narrow ladder is a measurement of a product nobody ships — which is the
    // red-run the probe's HARNESS-4 executes.
    const shell = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business-shell.css'), 'utf8')
    const optIn = shell.match(/\.biz \.app:has\(([^)]*)\) \{ min-width: 0; \}/)
    expect(optIn).not.toBeNull()
    expect(optIn![1].split(',').map((s) => s.trim())).toContain('.page.pg-ask-ai')
    // …and the selector is SHELL-owned: no route sheet may reach up and lift
    // its own floor.
    expect(CSS_CODE).not.toContain('.biz .app')
  })

  it('break-words is stated ONCE, on the room root, where it reaches every surface — including the ones not written yet', () => {
    // ⚠ THIS PIN USED TO ENUMERATE FIVE SURFACES, AND THE ENUMERATION IS WHAT
    // FAILED. The sheet stated `overflow-wrap: anywhere` per surface, this pin
    // listed the five somebody had remembered, and 接続済みデータ's own honesty
    // line was on neither list — so at 390 an unbroken run there scrolled the
    // whole document sideways (measured: probe build1 B3/B7). A list that has
    // to be kept in sync with a growing page is the defect, not the symptom.
    // `overflow-wrap` INHERITS, so the room states it once on its own root and
    // every surface it has or will grow is covered by construction.
    const root = /\.biz \.page\.pg-ask-ai \{ overflow-wrap: anywhere; \}/
    expect(CSS_CODE).toMatch(root)
    // …and exactly once: a second home would be a second thing to keep in sync.
    expect([...CSS_CODE.matchAll(/overflow-wrap:/g)]).toHaveLength(1)
    // `anywhere` rather than `break-word` is load-bearing — only `anywhere`
    // also shrinks the MIN-CONTENT contribution, which is what lets a flex or
    // grid track give way instead of being forced wide by one unbroken word.
    expect(CSS_CODE).not.toMatch(/overflow-wrap:\s*break-word/)
  })
})

describe('⚖ THE QUIET SECOND AXIS — a wash-tier tone per category, and nothing louder', () => {
  const CATEGORIES = ['customer_follow', 'staffing', 'booking', 'vip']

  it('the SCREEN states no colour at all — the category rides a data attribute', () => {
    // The screen hands the sheet a fact; the sheet decides what it looks like.
    // A className switch here would put the palette in two homes, and a category
    // the plane grows later would arrive with no rule and no fallback.
    expect(SRC_CODE).toContain('data-cat={c.category}')
    expect(SRC_CODE).not.toMatch(/ak-sug-(?:cat-|tone)/)
  })

  it('every canon category has a tone, and the BASE is neutral so a new one arrives grey', () => {
    // The neutral default is the whole reason a fifth category cannot turn up
    // wearing a fourth's colour (the カルテ room's own note, carried).
    expect(CSS_CODE).toMatch(/\.biz \.pg-ask-ai \.ak-sug \{ --ak-cat: 136, 135, 128; \}/)
    for (const cat of CATEGORIES) {
      expect({ cat, toned: new RegExp(`\\.ak-sug\\[data-cat="${cat}"\\] \\{ --ak-cat: \\d+, \\d+, \\d+; \\}`).test(CSS_CODE) })
        .toEqual({ cat, toned: true })
    }
    // four tones, four categories, no fifth rule waiting for a category that
    // does not exist
    expect([...CSS_CODE.matchAll(/\.ak-sug\[data-cat="([^"]+)"\]/g)].map((m) => m[1]).sort()).toEqual([...CATEGORIES].sort())
  })

  it('WASH TIER ONLY — the tone is never a fill, never text, and never touches a pressable', () => {
    // ⚖ the one-way accent law: colour on a non-pressable stays at wash level.
    // Every use of the tone is an rgba() with an alpha well under half, so there
    // is no solid fill and no coloured ink to be mistaken for "you can press me".
    const uses = [...CSS_CODE.matchAll(/rgba\(var\(--ak-cat\),\s*\.(\d+)\)/g)].map((m) => Number(`0.${m[1]}`))
    expect(uses.length).toBeGreaterThanOrEqual(2)
    for (const alpha of uses) expect({ alpha, wash: alpha <= 0.4 }).toEqual({ alpha, wash: true })
    // the tone never becomes ink…
    expect(CSS_CODE).not.toMatch(/color:\s*rgba?\(var\(--ak-cat\)/)
    // …and the card's chip keeps NEUTRAL text over its wash.
    expect(CSS_CODE).toMatch(/\.ak-sug-cat \{[^}]*background: rgba\(var\(--ak-cat\), \.14\);[^}]*color: var\(--ink-3\)/)
    // …and the two pressables inside a card are untouched by any of it.
    for (const block of CSS_CODE.split('}')) {
      if (/\.ak-open|\.ak-dismiss/.test(block.slice(0, block.indexOf('{') + 1))) {
        expect({ block: block.slice(0, 60), tone: block.includes('--ak-cat') }).toEqual({ block: block.slice(0, 60), tone: false })
      }
    }
  })
})

describe('⚖ THE DENIED PAGE IS DESIGNED, NOT LEFT OVER', () => {
  it('the permission note is a centred card at a readable measure', () => {
    // L4-4. A 13px bar in the top-left of an otherwise empty desk reads as a page
    // that failed to load. This reader's page is COMPLETE — it contains one
    // honest answer — so it is composed like one.
    const note = CSS_CODE.slice(CSS_CODE.indexOf('.biz .pg-ask-ai .ak-notice {'))
    const rule = note.slice(0, note.indexOf('}'))
    expect(rule).toMatch(/margin:\s*\d+px auto/)
    expect(rule).toMatch(/max-width:\s*\d+px/)
    expect(rule).toContain('text-align: center')
    // …and the sentence a reader needs first carries the weight.
    expect(CSS_CODE).toMatch(/\.ak-notice p:first-child \{[^}]*font-size: 15px/)
  })

  it('NOTHING about the denial is cosmetic — the construction is untouched', () => {
    // The card is a CSS treatment of a payload that already contains none of the
    // room's data; the room-side proof of that lives in ask-ai.test.ts (zero
    // data-door calls, empty payload). What this pin holds is that the screen
    // still renders the note INSTEAD of the room rather than over it.
    expect(SRC_CODE).toContain('const denied = props.noticeLines.length > 0')
    expect(SRC_CODE).toContain('{denied && (')
    expect(SRC_CODE).toContain('{!denied && (')
  })
})

describe('the boundary panel — present-but-inert, one mount', () => {
  it('renders once, hidden, and carries canon’s entitlement copy', () => {
    expect([...SRC_CODE.matchAll(/className="ak-boundary"/g)]).toHaveLength(1)
    const at = SRC_CODE.indexOf('className="ak-boundary"')
    const tag = SRC_CODE.slice(at, SRC_CODE.indexOf('>', at))
    expect(tag).toContain('hidden')
    expect(tag).toContain('aria-hidden="true"')
    // The matrix row defines only a boundary-ENTITLEMENT state, so there is no
    // rights-flavoured variant to build.
    expect(SRC_CODE).not.toContain('by_rights')
    expect(SRC_CODE).not.toContain('ak-boundary-rights')
  })
})
