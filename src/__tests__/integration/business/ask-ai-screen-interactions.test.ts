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
    // ⚠ RE-DERIVED FOR S15, and the change is the accepted mock's: 今日のヒント
    // and じっくり相談 were two headed blocks and are ONE 質問のヒント row of
    // chips now, so the census loses two names and gains one. Everything else is
    // where it was; the trace card kept its own name when it folded into the
    // footnote bar.
    expect(DECLARATIONS.map((d) => d.title).sort()).toEqual([
      'AI相談',
      'AIが提案する次のアクション',
      'さらに表示',
      'この画面の値の設定元',
      'この画面の見え方',
      '会話',
      '接続済みデータ',
      '業種の設定',
      '質問のヒント',
      '質問を入力',
    ].sort())
  })

  it('the CONDITIONAL sections declare too — they are the ones the walk drops', () => {
    // 今日のヒント in a store with no signals, 業種の設定 in a shop that has chosen
    // one, この画面の見え方 for a reader who has the permission, さらに表示 in a store
    // whose whole feed already fits: each renders behind a guard, and each
    // declares, so the walk's N/M shrinks and grows by itself.
    for (const title of ['質問のヒント', '業種の設定', 'この画面の見え方', 'さらに表示']) {
      expect(DECLARATIONS.map((d) => d.title)).toContain(title)
    }
    for (const guard of [
      '(props.signals.length > 0 || props.templates.length > 0) &&',
      'props.profileHint &&',
      'denied &&',
      'walk.moreLabel &&',
    ]) {
      expect(SRC_CODE).toContain(guard)
    }
    // …and INSIDE the merged row the 今日 group is its own conditional, so a
    // store with no signals shows じっくり alone rather than an empty group word.
    expect(SRC_CODE).toContain('{props.signals.length > 0 && (')
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
      ...[...SRC_CODE.matchAll(/className="ak-chat-hd"/g)].map((m) => ({ what: 'ak-chat-hd', at: m.index ?? 0 })),
      ...[...SRC_CODE.matchAll(/className="ak-rail-ttl"/g)].map((m) => ({ what: 'ak-rail-ttl', at: m.index ?? 0 })),
      ...[...SRC_CODE.matchAll(/className="ak-fn-title"/g)].map((m) => ({ what: 'ak-fn-title', at: m.index ?? 0 })),
      ...[...SRC_CODE.matchAll(/className="ak-hint-k"/g)].map((m) => ({ what: 'ak-hint-k', at: m.index ?? 0 })),
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
    // ⚠ RE-DERIVED FOR S15: the two column wrappers became one grid, and the
    // page gained its own content box (the 1416px cap + the ladder's container).
    // Neither holds content of its own, so neither declares.
    for (const wrapper of ['ak-page', 'ak-workspace', 'ak-rail-body']) {
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

  it('却下 collapses the card, says nothing was saved, and OFFERS THE UNDO', () => {
    expect(SRC_CODE).toContain('onClick={() => onDismiss(card.id)}')
    expect(SRC_CODE).toContain('const visible = props.feed.filter((c) => !dismissed.includes(c.id))')
    // ⚖ S15 — THE CARD LEAVES BEFORE THE LIST DOES. The press starts a spring
    // and the id joins `dismissed` at REST, so the row does not vanish under the
    // finger that pressed it; the toast is up immediately with its undo.
    expect(SRC_CODE).toContain('showToast(props.dismissToast, id)')
    expect(SRC_CODE).toContain('onRest: (v) => { if (v <= 0.5) onCollapsed(card.id) }')
    expect(SRC_CODE).toContain('response: 0.28')
    // 元に戻す catches the card in EITHER state — still collapsing, or already
    // dismissed — because both are one request from the reader.
    expect(SRC_CODE).toContain('const undo = (id: string) => {')
    // ⚠ RE-PINNED AT F-A1: `collapsing` is a LIST now, so undo removes its own id
    // from it rather than clearing the one slot (which is what let a second 却下
    // cancel the first card's flight).
    expect(SRC_CODE).toContain('setCollapsing((was) => was.filter((x) => x !== id))')
    expect(SRC_CODE).toContain('setDismissed((was) => was.filter((x) => x !== id))')
    expect(SRC_CODE).toContain('onClick={() => undo(toast.undoId!)}')
    // …and the count above the list is the VISIBLE count, so a dismissal moves
    // the number a reader is looking at (one call, rendered twice — ⚖ A8).
    expect(SRC_CODE).toContain('提案 <b>{visible.length}</b>件')
  })

  it('⚖ F-A1 — TWO 却下 IN FLIGHT AT ONCE, and neither dismissal is lost', () => {
    // THE BUG THIS PIN EXISTS FOR (Fable line audit, tip e76f1cdcb): `collapsing`
    // was ONE id. A second 却下 while the first card's spring was still running
    // re-rendered the FIRST card with `collapsing=false` — its effect cleanup
    // stopped the spring before `onRest` could fire and the effect body stripped
    // its inline height, so the card snapped back to full size and never entered
    // `dismissed`. A gesture ENDING that tore nothing down (⚖ §A-9), and the
    // reader was left with a card they had already dismissed.
    expect(SRC_CODE).toContain('const [collapsing, setCollapsing] = useState<string[]>([])')
    // dismiss APPENDS…
    expect(SRC_CODE).toContain('setCollapsing((was) => (was.includes(id) ? was : [...was, id]))')
    // …each card reads its OWN flag out of the list…
    expect(SRC_CODE).toContain('collapsing={collapsing.includes(c.id)}')
    // …and both endings remove only their own id, so one card's rest can never
    // cancel another's flight.
    expect(SRC_CODE).toContain('setCollapsing((was) => was.filter((x) => x !== id))')
    expect(SRC_CODE).not.toMatch(/setCollapsing\(\(c\) => \(c === id \? null : c\)\)/)
    expect(SRC_CODE).not.toMatch(/useState<string \| null>\(null\)[\s\S]{0,40}collapsing/)
    // …and `onCollapsed` still appends to `dismissed` exactly once per id, which
    // is what makes N−2 the honest count after two presses.
    const onCollapsed = SRC_CODE.slice(SRC_CODE.indexOf('const onCollapsed'), SRC_CODE.indexOf('const undo'))
    expect(onCollapsed).toContain('setDismissed((was) => (was.includes(id) ? was : [...was, id]))')
    expect(onCollapsed).toContain('setCollapsing((was) => was.filter((x) => x !== id))')
  })

  it('⚖ F-A2 — the rail head is a PRESSABLE only where it presses something', () => {
    // ⚖ §A-2, the dead-lever class. The head was a `<button data-press>` at every
    // width: at the desk its handler was a no-op, the sheet said `cursor: default`
    // and the press scale fired anyway — a control that answers a finger with
    // nothing. It is a plain row at the desk and the 提案 bar's toggle at phone.
    expect(SRC_CODE).toContain('{railCollapsible ? (')
    expect(SRC_CODE).toContain('<div className="ak-rail-hd">')
    // the BUTTON spelling exists only inside the collapsible branch, and it is
    // the one that carries the press state and the expanded flag
    const branch = SRC_CODE.slice(SRC_CODE.indexOf('{railCollapsible ? ('), SRC_CODE.indexOf('<div className="ak-rail-hd">'))
    expect(branch).toContain('aria-expanded={railOpen}')
    expect(branch).toContain('data-press')
    expect(branch).toContain('onClick={() => setRailOpen((was) => !was)}')
    // …and the no-op spelling is gone in both of its halves
    expect(SRC_CODE).not.toContain('aria-expanded={railCollapsible ? railOpen : undefined}')
    expect(SRC_CODE).not.toContain('onClick={() => { if (railCollapsible) setRailOpen((was) => !was) }}')
    // the chevron only renders where there is something to turn
    expect(branch).toContain('ak-rail-cv')
    const plain = SRC_CODE.slice(SRC_CODE.indexOf('<div className="ak-rail-hd">'))
    expect(plain.slice(0, plain.indexOf('</div>'))).not.toContain('ak-rail-cv')
  })

  it('⚖ F-A3 — NOTHING CLIPS AT THE DESK: a card’s hover lift paints whole', () => {
    // Both clips existed only to animate a size to zero, and both were on at
    // every width — so every card's own `:hover` shadow (14px of blur) was cut on
    // three sides, and a focus ring at a card's edge could be cut with it.
    const desk = CSS_CODE.slice(0, CSS_CODE.indexOf('@container'))
    expect(desk).not.toMatch(/\.ak-sug \{[^}]*overflow/)
    expect(desk).not.toMatch(/\.ak-rail-body[^{]*\{[^}]*overflow/)
    // the card clips ONLY while it is leaving…
    expect(CSS_CODE).toContain('.biz .pg-ask-ai .ak-sug.ak-leaving { overflow: hidden; }')
    expect(SRC_CODE).toContain("el.classList.add('ak-leaving')")
    expect(SRC_CODE).toContain("el.classList.remove('ak-leaving')")
    // …and the rail body clips only in the ONE band that springs its height.
    const phoneBand = CSS_CODE.slice(CSS_CODE.indexOf('@container akpage (max-width: 599px)'))
    expect(phoneBand.slice(0, phoneBand.indexOf('@media'))).toContain('.ak-rail-body { overflow: hidden; height: 0; }')
    // …and the hover lift the clip was eating is still there to paint.
    expect(desk).toMatch(/\.ak-sug-in:hover \{[^}]*box-shadow: var\(--ak-shadow-2\)/)
  })

  it('⚖ THE FEED IS WINDOWED, and the head’s count is still the TOTAL', () => {
    // L4-2. The window is browsing state like the dismissed list, taken off the
    // list the reader can still SEE — so 「提案 N件」 above and 「あと M件」 below
    // are two readings of one call and can never describe two lists.
    expect(SRC_CODE).toContain('const [feedSteps, setFeedSteps] = useState(1)')
    expect(SRC_CODE).toContain('const walk = windowFeed(visible, feedSteps)')
    expect(SRC_CODE).toContain('{walk.shown.map((c) => (')
    // the head counts the TOTAL, never the window — the two must not agree by
    // being the same expression
    expect(SRC_CODE).toContain('提案 <b>{visible.length}</b>件')
    expect(SRC_CODE).not.toContain('提案 <b>{walk.shown.length}</b>件')
    // the control's own label is DERIVED in the lib beside the arithmetic; this
    // file states no count of its own
    expect(SRC_CODE).toContain('{walk.moreLabel}')
    expect(SRC_CODE).not.toMatch(/さらに表示（あと/)
    expect(SRC_CODE).toContain('onClick={() => setFeedSteps((s) => s + 1)}')
    // …and the band is the カルテ room's own footer shape, with no scroller and
    // no height cap anywhere near it (⚖ page-scroll: the WINDOW shortens the
    // page, it does not put an axis on a box).
    expect(CSS_CODE).toContain('.biz .pg-ask-ai .ak-more {')
    expect(CSS_CODE).not.toMatch(/\.ak-more[^{]*\{[^}]*(overflow|max-height)/)
    // …and below the two-column band it rides the STRIP as its last item rather
    // than dropping out of the reader's reach under a sideways row.
    expect(CSS_CODE).toMatch(/@container akpage \(max-width: 907px\)[\s\S]*?\.ak-more \{ flex: 0 0 auto/)
  })

  it('⚖ F2-5 — the 設定する CTA answers in ITS OWN section, and the composer’s slot stays send-only', () => {
    // `aria-disabled` rather than `disabled`: the control stays focusable so its
    // reason is reachable by keyboard and screen reader, and the reason rides the
    // ACCESSIBLE NAME as well as the title (a screen reader drops `title`).
    expect(SRC_CODE).toContain('aria-disabled="true"')
    expect(SRC_CODE).toContain('title={props.refusals.settings}')
    expect(SRC_CODE).toContain('aria-label={`${props.profileHint.cta} — ${props.refusals.settings}`}')
    expect(SRC_CODE).toContain('onClick={() => setSettingsRefused(true)}')

    // S7-5: the reason used to render in the COMPOSER's slot — measured 221px
    // below the button and off screen at the moment of the press, which is a
    // control that looks like it did nothing. It renders inside 業種の設定 now.
    const bodyOf = (marker: string) => {
      const tag = SECTIONS.find((t) => t.text.includes(marker))!
      const span = spanOf(SRC_CODE, 'section', tag)
      return SRC_CODE.slice(span.start, span.end)
    }
    const profile = bodyOf('className="ak-profile"')
    expect(profile).toContain('{settingsRefused && (')
    expect(profile).toContain('className="ak-refusal ak-profile-refusal"')
    expect(profile).toContain('{props.refusals.settings}')
    // …and the composer's own slot never carries the settings reason again.
    const composer = bodyOf('className="ak-composer"')
    expect(composer).not.toContain('refusals.settings')
    expect(composer).toContain('{refusal.reason}')
    // Both slots wear the SAME family refusal treatment — one recipe, two homes
    // for two different questions.
    expect(CSS_CODE).toContain('.biz .pg-ask-ai .ak-profile-refusal')
    expect(SRC_CODE).toContain('const [settingsRefused, setSettingsRefused] = useState(false)')
  })

  it('⚖ F2-3 — a 今日のヒント chip never destroys a typed question', () => {
    // S7-3: over a half-written question the chip's fill was a silent,
    // unrecoverable delete of the reader's own words — the exact thing the
    // refusal path exists never to do (⚖ §A-7). Both branches are pinned.
    // ⚠ RE-PINNED ON THE ONE HELPER (S15). The guard used to live inside
    // `takeSignal`; 「もう一度送る」 now walks the same path (⚖-ADJ F), so the guard
    // moved into `walkSend` — ONE home, which is what stops the second control
    // from growing a second answer to the same question (⚖ A8).
    const body = SRC_CODE.slice(SRC_CODE.indexOf('const walkSend'), SRC_CODE.indexOf('const takeSignal'))
    expect(body).toContain("const typed = draft.trim() !== '' && draft !== text")
    // EMPTY BOX (or the same question already in it): today's behaviour, kept.
    expect(body).toContain('if (!typed) setDraft(text)')
    // TYPED BOX: the draft is untouched and the question goes into the refusal
    // instead, where the reader can read and copy it.
    expect(body).toContain('refuseSend(contextLabel, typed ? text : null)')
    // …and there is exactly ONE write to the draft in this handler, the guarded
    // one: a second, unguarded `setDraft` anywhere in the body would be the
    // overwrite coming back by another door.
    expect([...body.matchAll(/setDraft\(/g)]).toHaveLength(1)
    // …and BOTH controls that carry a question go through it.
    expect(SRC_CODE).toContain('const takeSignal = (chip: SignalChip) => walkSend(chip.prompt, chip.contextLabel)')
    expect(SRC_CODE).toContain('const takeRetry = (q: { text: string; contextLabel: string | null }) => walkSend(q.text, q.contextLabel)')
    expect(SRC_CODE).toContain('{refusal.intended && (')
    expect(SRC_CODE).toContain('この質問を送る予定でした：{refusal.intended}')
    // …beside the context label the same press already showed, and with its own
    // quiet treatment.
    expect(SRC_CODE).toContain('読み取る予定だったデータ：{refusal.contextLabel}')
    expect(CSS_CODE).toContain('.biz .pg-ask-ai .ak-refusal-kept')
  })

  it('⚖ F2-1 — the feed has a SECOND empty state, and the tour step is true in both', () => {
    // S7-1. Which empty is showing is a FACT about this screen, not a guess: a
    // feed that arrived with rows and is empty now was emptied by this reader.
    expect(SRC_CODE).toContain('const emptyState = props.feed.length > 0 ? props.feedDismissedEmpty : props.feedEmpty')
    expect(SRC_CODE).toContain('<strong>{emptyState.title}</strong>')
    expect(SRC_CODE).toContain('<span>{emptyState.body}</span>')
    // Neither sentence is written here — both are props, one home each.
    expect(SRC_CODE).not.toContain('提案はまだありません')
    expect(SRC_CODE).not.toContain('却下は保存されない')
    // …and the feed's own tour sentence no longer promises cards while the
    // spotlight is sitting on an empty box.
    const feedStep = DECLARATIONS.find((d) => d.title === 'AIが提案する次のアクション')!
    expect(feedStep.text).not.toContain('1件ごとに根拠が付いていて')
    expect(feedStep.text).toContain('並ぶところです')
    expect(feedStep.text).toContain('却下はこの画面の中だけの操作')
  })

  it('⚖ F2-2 — 出典 has ONE home: the derived label, alone', () => {
    // S7-2: the head printed a standalone 「出典」 span beside the derived
    // 「出典 3件」, so the word appeared twice in one line and its label lived in
    // two places. The derived string already carries the label (⚖ 8/25).
    expect(SRC_CODE).toContain('<div className="ak-cites-k">{t.sourceCountLabel}</div>')
    const head = SRC_CODE.slice(
      SRC_CODE.indexOf('className="ak-cites"'),
      SRC_CODE.indexOf('{t.sources.map'),
    )
    expect(head.length).toBeGreaterThan(20)
    expect(head).not.toContain('出典')
    expect(SRC_CODE).not.toContain('ak-cites-label')
    expect(SRC_CODE).not.toContain('ak-cites-count')
    expect(CSS_CODE).not.toContain('.ak-cites-label')
    expect(CSS_CODE).not.toContain('.ak-cites-count')
  })

  it('⚖-ADJ E — A CITE PILL IS NOT PRESSABLE, and does not look like one', () => {
    // Registry ⑥: no shipped room accepts a record-level param at this tip, so
    // there is nowhere for a pill to go and this room invents no param. A door
    // that does not open must not LOOK like a door (⚖ §A-2's other half — the
    // dead-lever class starts with something that reads as a lever).
    const citeRow = SRC_CODE.slice(SRC_CODE.indexOf('className="ak-citerow"'), SRC_CODE.indexOf('</div>', SRC_CODE.indexOf('className="ak-citerow"')) + 400)
    expect(citeRow).toContain('<span className="ak-cite" key={s.ref}>')
    expect(citeRow).not.toContain('<button')
    expect(citeRow).not.toContain('<Link')
    expect(citeRow).not.toContain('onClick')
    expect(citeRow).not.toContain('data-press')
    // …and the sheet gives it no pointer, no lift and no shadow — a wash tint on
    // a non-pressable, which the one-way accent law allows at exactly this tier.
    const rule = CSS_CODE.slice(CSS_CODE.indexOf('.biz .pg-ask-ai .ak-cite {'))
    const body = rule.slice(0, rule.indexOf('}'))
    expect(body).not.toContain('cursor')
    expect(body).not.toContain('transition')
    expect(CSS_CODE).not.toContain('.ak-cite:hover')
  })

  it('⚖ S15 — the ONE 質問のヒント row: two group words, chips that carry their own preview', () => {
    // The two prompt systems keep their two behaviours (pinned in ask-ai.test)
    // and lose their two headings. A chip's LABEL is the short word and the long
    // one rides the native `title` — ⚖-ADJ G rules the mock's hover popover
    // MOCK-ONLY, because a native tooltip carries the same text with no floating
    // layer to clamp at four edges.
    expect(SRC_CODE).toContain('<span className="ak-hint-k">質問のヒント</span>')
    expect(SRC_CODE).toContain('<span className="ak-hint-g">今日</span>')
    expect(SRC_CODE).toContain('<span className="ak-hint-g">じっくり</span>')
    expect(SRC_CODE).toContain('<span className="ak-gsep" />')
    expect(SRC_CODE).toContain('title={s.title} onClick={() => takeSignal(s)}')
    expect(SRC_CODE).toContain('title={t.preview} onClick={() => takeTemplate(t)}')
    // the chip's own words: a signal reads by its TAG, a template by its TITLE
    expect(SRC_CODE).toMatch(/onClick=\{\(\) => takeSignal\(s\)\}>\s*\{s\.tag\}/)
    expect(SRC_CODE).toMatch(/onClick=\{\(\) => takeTemplate\(t\)\}>\s*\{t\.title\}/)
    // …and at phone it is ONE swipeable strip: a horizontal pan in its own
    // container, with no height of its own (⚖ page-scroll).
    const phoneBand = CSS_CODE.slice(CSS_CODE.indexOf('@container akpage (max-width: 599px)'))
    expect(phoneBand).toMatch(/\.ak-hintrow \{ flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden/)
  })

  it('⚖-ADJ C · I — the two disclosures open IN FLOW, downward, on the family’s spring', () => {
    // The mock's help popover and its UPWARD absolute footnote panel are
    // mock-only: a floating layer has to be clamped at four edges and can cover
    // its own anchor (the ⚖ popup laws). Both of this room's disclosures are
    // height springs on a panel that is part of the document.
    for (const panel of ['ak-why-panel', 'ak-fn-panel']) {
      expect(CSS_CODE).toMatch(new RegExp(`\\.${panel} \\{ height: 0; overflow: hidden; \\}`))
      expect(CSS_CODE).not.toMatch(new RegExp(`\\.${panel} \\{[^}]*position: absolute`))
    }
    expect(SRC_CODE).toContain('useCollapse(whyRef, whyOpen, reduced)')
    expect(SRC_CODE).toContain('useCollapse(footRef, footOpen, reduced)')
    expect(SRC_CODE).toContain('aria-expanded={whyOpen}')
    expect(SRC_CODE).toContain('aria-expanded={footOpen}')
    // …and the head's old sentence really did MOVE rather than being cut: it is
    // the first line the pop-down carries.
    expect(SRC_CODE).toContain('{props.why.lines.map((line) => (')
    expect(SRC_CODE).not.toContain('className="ak-subtitle"')
  })

  it('⚖ MOTION — one integrator, the family’s, and both borrowed pieces carry their cite', () => {
    // The Studio standard: transform/opacity only, springs for state. The
    // integrator is the family's shared `makeSpring`; the collapse hook and the
    // `[data-press]` listener are the 録音 room's, copied WITH their file:line
    // because a room may not import a sibling room's SCREEN (the R7-6 precedent,
    // and the shared home for them is a family-sweep item).
    expect(SRC_CODE).toContain("import { makeSpring } from '@/business/lib/spring'")
    // ⚠ THE CITES ARE READ FROM THE RAW SOURCE, not from `SRC_CODE`: they live
    // in the comments beside the copies, which is exactly where a cite belongs
    // and exactly what `stripComments` removes.
    expect(SRC).toContain('business/recording/RecordingScreen.tsx:816-841')
    expect(SRC).toContain('RecordingScreen.tsx:842-859')
    expect(SRC_CODE).toContain("t.classList.add('is-pressed')")
    // the presses are ONE rule over the attribute rather than a per-control sweep
    expect(CSS_CODE).toContain('.biz .pg-ask-ai [data-press] { transition: transform 100ms ease-out; }')
    expect(CSS_CODE).toContain('.biz .pg-ask-ai [data-press].is-pressed { transform: scale(.97); }')
    // …and nothing animates on FIRST PAINT: the first run of every collapse jumps
    expect(SRC_CODE).toContain("el.style.height = open ? 'auto' : '0px'")
    // reduced motion is answered at CONSTRUCTION time, so the state still changes
    expect(SRC_CODE).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')")
    expect([...SRC_CODE.matchAll(/reduced,/g)].length).toBeGreaterThanOrEqual(3)
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
  const containerBands = [...CSS_CODE.matchAll(/@container ([^{]+)\{/g)].map((m) => m[1].trim())

  it('⚖-ADJ J — the COMPOSITION ladder is keyed to the PAGE, and only device facts stay on @media', () => {
    // THE HAZARD the container ladder exists for (the 録音 room's F-V5 lesson,
    // ported): the shell's rail is 76px collapsed and 264px open, so PAGE WIDTH
    // FALLS BY 188px as the viewport crosses 1024. A rule that chose a column
    // count from a viewport width would be choosing it from the wrong number.
    expect(CSS_CODE).toContain('container-type: inline-size; container-name: akpage;')
    expect(containerBands).toEqual([
      'akpage (max-width: 907px)',
      'akpage (max-width: 599px)',
    ])
    // …and what is left on @media is what genuinely belongs to the VIEWPORT:
    // the page's own outer padding, the ≥44px touch floor and reduced motion.
    expect(bands).toEqual([
      '(min-width: 1400px)',
      '(max-width: 1279px)',
      '(max-width: 743px)',
      '(prefers-reduced-motion: reduce)',
    ])
    // THE THRESHOLDS ARE DERIVED, NOT CHOSEN: a chat column stops being a
    // workspace under ~620px, the rail's floor is 276px and the gap is 12 —
    // 620 + 276 + 12 = 908, so two columns hold to 908 and stack at 907.
    expect(CSS_CODE).toContain('clamp(276px, 26cqi, 364px)')
  })

  it('the two zones stack when the PAGE cannot hold them, consultation FIRST', () => {
    expect(CSS_CODE).toMatch(/@container akpage \(max-width: 907px\) \{[\s\S]*?\.ak-workspace \{ grid-template-columns: minmax\(0, 1fr\)/)
    // ⚖-ADJ K — THE ONE `order` RULE IN THE SHEET, and it is inside the phone
    // band. A collapsed 44px 提案 bar is a HEADER, not a zone: the chat is still
    // the page under it, which is what the accepted 440 shot shows. The old pin
    // forbade `order:` outright; it is re-pinned to allow exactly this one rule,
    // in exactly this band, so a second one still fails the round.
    const orders = [...CSS_CODE.matchAll(/[^;{}]*\border\s*:\s*-?\d[^;}]*/g)].map((m) => m[0].trim())
    expect(orders).toEqual(['order: -1'])
    const phoneBand = CSS_CODE.slice(CSS_CODE.indexOf('@container akpage (max-width: 599px)'))
    expect(phoneBand.slice(0, phoneBand.indexOf('@media'))).toContain('.ak-rail { order: -1; }')
    // …and above that band the DOM order is the stack order: the consultation is
    // the titular function and is written first, so nothing has to reorder it.
    expect(SRC_CODE.indexOf('className="ak-chat"')).toBeLessThan(SRC_CODE.indexOf('className="ak-rail"'))
  })

  it('≤743 raises every interactive control to ≥44px, swept flat', () => {
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    for (const sel of [
      '.ak-send', '.ak-door', '.ak-dismiss', '.ak-hchip', '.ak-namechip', '.ak-retry',
      '.ak-sug-open', '.ak-rail-hd', '.ak-fn-bar', '.ak-why', '.ak-undo', '.ak-btn-out',
      '.ak-profile-cta', '.ak-spot-foot button', '.btn',
    ]) {
      expect({ sel, raised: new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{[^}]*min-height: 4[46]px`).test(phone) })
        .toEqual({ sel, raised: true })
    }
    // …and the ? keeps its 22px PAINT and grows its HIT BOX instead.
    expect(phone).toContain('.biz .pg-ask-ai .ak-help::after')
  })

  it('⚖ THE F2-9 CLASS, SOLVED STRUCTURALLY — the rail head is ONE row that cannot collide with its own count', () => {
    // S7-10 was a WRAP defect: at 390 the head's title wrapped to two lines and
    // 「提案 7件」 landed on the second line's baseline. The accepted mock's head
    // solves the class rather than the case — title · flexible spacer · count ·
    // chevron, all `align-items: center`, so the count is never asked to share a
    // baseline with a wrap. The old pin named two rules that no longer exist;
    // this one names the shape that makes the defect impossible.
    const desk = CSS_CODE.slice(0, CSS_CODE.indexOf('@container'))
    expect(desk).toMatch(/\.ak-rail-hd \{[^}]*align-items: center/)
    expect(desk).toMatch(/\.ak-rail-cnt \{[^}]*white-space: nowrap/)
    // ⚠ RE-PINNED AT F-A2: the head renders in two spellings now — a button at
    // phone and a plain row at the desk — so the SHAPE is pinned in both rather
    // than by one indentation. In each, the count follows a flexible spacer, on
    // one centred row.
    for (const half of [
      SRC_CODE.slice(SRC_CODE.indexOf('{railCollapsible ? ('), SRC_CODE.indexOf('<div className="ak-rail-hd">')),
      SRC_CODE.slice(SRC_CODE.indexOf('<div className="ak-rail-hd">')),
    ]) {
      const upto = half.slice(0, half.indexOf('ak-rail-cnt') + 12)
      expect(upto.indexOf('ak-rail-ttl')).toBeLessThan(upto.indexOf('ak-sp'))
      expect(upto.indexOf('ak-sp')).toBeLessThan(upto.indexOf('ak-rail-cnt'))
    }
    // …and at the touch band the whole head is a ≥44px target, because there it
    // is the control that opens the 提案 bar.
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(phone).toMatch(/\.ak-rail-hd \{[^}]*min-height: 44px/)
  })

  it('⚖ ULTRA-WIDE — ONE width token, and every section of the page is on it', () => {
    // ⚖ Liam 9/2's own law, and the accepted mock's own number. The cap is a
    // TOKEN so the head, the trust row, the work row and the footnote can never
    // drift onto four different pairs of edges — and it is stated again on each
    // of them as the backstop, which is the 録音 room's v5-2 shape.
    expect(CSS_CODE).toMatch(/--ak-maxw: 1416px;/)
    const capped = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*max-width: var\(--ak-maxw\)[^}]*\}/g)]
      .flatMap((m) => m[1].trim().split(',').map((x) => x.trim().split('\n').pop()!.trim()))
    expect(capped.sort()).toEqual([
      '.biz .pg-ask-ai .ak-footnote',
      '.biz .pg-ask-ai .ak-head',
      '.biz .pg-ask-ai .ak-page',
      '.biz .pg-ask-ai .ak-profile',
      '.biz .pg-ask-ai .ak-trust',
      '.biz .pg-ask-ai .ak-workspace',
    ])
    // …and the cap CENTRES rather than pinning to an edge.
    expect(CSS_CODE).toMatch(/\.ak-page \{[\s\S]{0,120}margin-inline: auto/)
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
    expect(SRC_CODE).toContain('data-cat={card.category}')
    expect(SRC_CODE).not.toMatch(/ak-sug-(?:cat-|tone)/)
  })

  it('every canon category has a tone, and the BASE is neutral so a new one arrives grey', () => {
    // ⚠ RE-PINNED FOR S15 (LIAM-VISIBLE): the accepted mock RETIRES the
    // カルテ-borrowed palette the 8/31 build shipped (teal / violet / pink /
    // orange) and gives each canon category one hue spent in three places — the
    // card's left rule, the icon's wash and the category WORD's ink. The tone is
    // three named custom properties now rather than one rgb triple, because the
    // three places want three different saturations of it.
    //
    // The neutral default is the whole reason a fifth category cannot turn up
    // wearing a fourth's colour (the カルテ room's own note, carried).
    expect(CSS_CODE).toMatch(/\.ak-sug-in \{\s*--ak-cat-rule: var\(--ak-slate-line\);\s*--ak-cat-wash: var\(--ak-wash\);\s*--ak-cat-ink: var\(--ink-3\);\s*\}/)
    for (const cat of CATEGORIES) {
      expect({ cat, toned: new RegExp(`\\.ak-sug-in\\[data-cat="${cat}"\\] \\{ --ak-cat-rule: [^;]+; --ak-cat-wash: [^;]+; --ak-cat-ink: [^;]+; \\}`).test(CSS_CODE) })
        .toEqual({ cat, toned: true })
    }
    // four tones, four categories, no fifth rule waiting for a category that
    // does not exist
    expect([...CSS_CODE.matchAll(/\.ak-sug-in\[data-cat="([^"]+)"\]/g)].map((m) => m[1]).sort()).toEqual([...CATEGORIES].sort())
    // …and the SCREEN has no fifth glyph either: a category the plane grows later
    // gets the neutral mark rather than borrowing one.
    expect(SRC_CODE).toContain('{CATEGORY_MARK[card.category] ?? <NeutralMark />}')
  })

  it('WASH TIER ONLY — the tone is a rule, a wash and ONE label, and never touches a pressable', () => {
    // ⚖ THE ONE-WAY ACCENT LAW, AND THE ONE PLACE THIS ROOM ARGUES AT IT. The
    // mock colours the category WORD, and the S15 packet §2.5 rules it in: it is
    // a 10.5px/700 LABEL naming which AI設定 switch produced the row, it sits on
    // a non-pressable, and its hue is the card's own rule. The previous build's
    // pin said 「the tone never becomes ink」; this one says WHERE it may, and
    // holds everything else exactly where it was.
    const inked = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*color: var\(--ak-cat-ink\)[^}]*\}/g)]
      .map((m) => m[1].trim().split('\n').pop()!.trim())
    expect(inked.sort()).toEqual(['.biz .pg-ask-ai .ak-sug-ic', '.biz .pg-ask-ai .ak-sug-w'])
    // the card's BACKGROUND is never the tone — only its 3px left rule and the
    // 17px icon chip are, which is the wash tier the law allows.
    const filled = [...CSS_CODE.matchAll(/([^{}]+)\{[^}]*background: var\(--ak-cat-wash\)[^}]*\}/g)]
      .map((m) => m[1].trim().split('\n').pop()!.trim())
    expect(filled).toEqual(['.biz .pg-ask-ai .ak-sug-ic'])
    expect(CSS_CODE).toMatch(/\.ak-sug-in \{[^}]*border-left: 3px solid var\(--ak-cat-rule\)/)
    // …and the two pressables inside a card are untouched by any of it.
    for (const block of CSS_CODE.split('}')) {
      if (/\.ak-door|\.ak-dismiss/.test(block.slice(0, block.indexOf('{') + 1))) {
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
