/**
 * @jest-environment jsdom
 *
 * 録音 — ⚖ Liam's 8/23 GUIDED ?-TOUR law and ⚖ R6-D4's DESIGN GATE, this room's
 * half.
 *
 * THE TOUR LAW: every Business page ships the 画面の説明 tour in the 今日の運営
 * style — a ? trigger, a spotlight walk of the page's sections in visual order,
 * and tap-any-element-to-learn during the walk. Sections SELF-REGISTER by
 * declaring `data-guide` + `data-guide-title` on themselves, so anything that
 * renders is explained and anything hidden drops out.
 *
 * THE CENSUS IS STRUCTURAL, and it is asked from BOTH sides — the room-4 lesson,
 * inherited: a census that only counts what declares itself can never notice
 * what does not.
 *   · HERE, on the source: every `<section>` and every `<header>` this screen
 *     renders must carry the pair, and every HEADING it prints must sit inside a
 *     declared element. Derived from the JSX itself — there is no list to keep in
 *     sync, and a new section that forgets to declare fails the round the day it
 *     lands.
 *   · IN THE BROWSER, on the REAL rendered DOM (`probe/`): the census is taken
 *     again on both screens, every heading is TAPPED, and the card is measured
 *     against the hole. That is where containment is decided, because
 *     containment is a fact about rects and this file has no layout to decide it
 *     in.
 *
 * THE DESIGN GATE (⚖ R6-D4 moved the bar into the packet): the phone's own
 * recording tokens are QUOTED, not approximated, and the pins below are what
 * makes that checkable — the record button's family, the reserved overshoot
 * curve, the composite-only waveform, the breathe keyframe's own numbers, the
 * quiet 破棄済み chip, and the motion-safe gate over every one of them.
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
import { keepCardOffHeading } from '@/business/lib/recording'

const ROOM_DIR = 'src/app/[locale]/(business)/business/recording'
const SRC = readFileSync(join(process.cwd(), `${ROOM_DIR}/RecordingScreen.tsx`), 'utf8')
const CSS = readFileSync(join(process.cwd(), `${ROOM_DIR}/recording.css`), 'utf8')
const SIDEBAR = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/BusinessSidebar.tsx'), 'utf8')
/** The SHARED engine, read whole (comments included): the room wires its own
 *  trigger and overlay to it, and the engine's contract for every other room is
 *  unchanged by this one. */
const GUIDE_CODE = readFileSync(join(process.cwd(), 'src/business/lib/guide.ts'), 'utf8')

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
const SRC_CODE = stripComments(SRC).replace(/^\s*\/\/.*$/gm, '')
const CSS_CODE = stripComments(CSS)

type Declaration = { title: string; text: string; at: number }
const DECLARATIONS: Declaration[] = [
  ...SRC_CODE.matchAll(/data-guide-title="([^"]*)"\s*\n\s*data-guide="([^"]*)"/g),
].map((m) => ({ title: m[1], text: m[2], at: m.index ?? 0 }))

// ═══ THE TOUR CENSUS ════════════════════════════════════════════════════════

describe('⚖ 8/23 — 画面の説明, the census from the source side', () => {
  it('EVERY section and header this screen renders declares itself', () => {
    const undeclared: string[] = []
    for (const m of SRC_CODE.matchAll(/<(section|header)\b([\s\S]*?)>/g)) {
      const attrs = m[2]
      if (!attrs.includes('data-guide-title=') || !attrs.includes('data-guide=')) {
        undeclared.push(`<${m[1]} ${attrs.slice(0, 90).replace(/\s+/g, ' ').trim()}…>`)
      }
    }
    expect(undeclared).toEqual([])
    // …and there really are sections to count.
    expect([...SRC_CODE.matchAll(/<section\b/g)].length).toBeGreaterThanOrEqual(10)
  })

  it('every declaration is PAIRED, non-empty and UNIQUE', () => {
    expect(DECLARATIONS.length).toBe([...SRC_CODE.matchAll(/data-guide-title="/g)].length)
    expect(DECLARATIONS.length).toBe([...SRC_CODE.matchAll(/data-guide="/g)].length)
    for (const d of DECLARATIONS) {
      expect(d.title.trim().length).toBeGreaterThan(0)
      expect(d.text.trim().length).toBeGreaterThan(20)
    }
    expect(new Set(DECLARATIONS.map((d) => d.title)).size).toBe(DECLARATIONS.length)
  })

  it('EVERY HEADING sits inside a declared element — a reader taps the WORD', () => {
    // The walk has to be able to jump to what a reader points at, and a reader
    // points at the title. A heading outside every declared region is a section
    // the tour cannot reach.
    // ⚠ A DIALOG'S HEADING IS NOT A PAGE SECTION, and it is exempt for a
    // structural reason rather than a convenient one: the tour and a modal are
    // mutually exclusive layers — the walk cannot run while a dialog is up, and
    // a dialog cannot open during the walk — so a modal's title is never a step
    // the walker could reach. The census below therefore skips headings inside
    // an `<Overlay>` and counts every other one.
    const orphans: string[] = []
    for (const m of SRC_CODE.matchAll(/<(h1|h2|h3)\b/g)) {
      const before = SRC_CODE.slice(0, m.index ?? 0)
      const inDialog =
        [...before.matchAll(/<Overlay\b/g)].length > [...before.matchAll(/<\/Overlay>/g)].length
      if (inDialog) continue
      const opens = [...before.matchAll(/<(section|header)\b/g)].length
      const closes = [...before.matchAll(/<\/(section|header)>/g)].length
      if (opens <= closes) orphans.push(SRC_CODE.slice(m.index ?? 0, (m.index ?? 0) + 60))
    }
    expect(orphans).toEqual([])
    // …and the exemption is NARROW: every dialog heading that exists is inside
    // an Overlay, so nothing else can hide behind it.
    expect([...SRC_CODE.matchAll(/<Overlay\b/g)].length).toBe([...SRC_CODE.matchAll(/<\/Overlay>/g)].length)
  })

  it('the tour copy is PLAIN — no jargon, no code words, no room codes', () => {
    const all = DECLARATIONS.map((d) => `${d.title} ${d.text}`).join(' ')
    expect(all).not.toMatch(/registry|props|fixture|API|DTO|W7|registry ⑦|SDK/i)
    // …and it never spells a threshold the data already says (one home).
    expect(all).not.toMatch(/\d+秒未満/)
  })

  it('the room wires the SHARED engine and adds no second one', () => {
    expect(SRC_CODE).toContain("from '@/business/lib/guide'")
    for (const fn of ['spotTargets', 'spotCardAt', 'spotHitIndex', 'wrapStep']) {
      expect(SRC_CODE).toContain(fn)
      // …and does not reimplement it
      expect(SRC_CODE).not.toMatch(new RegExp(`function ${fn}\\b`))
    }
    expect(GUIDE_CODE).toContain('export function spotTargets')
  })

  it('the tour’s own layers are `rc-`-prefixed — 今日の運営 owns bare `.biz .spot-*`', () => {
    for (const n of ['rc-spot-catch', 'rc-spot-hover', 'rc-spot-hole', 'rc-spot-card']) {
      expect(CSS_CODE).toContain(n)
    }
    expect(CSS_CODE).not.toMatch(/\.biz \.spot-/)
  })
})

describe('the engine, really run over this room’s own shapes', () => {
  it('spotTargets picks up anything that declares itself, and drops what is not laid out', () => {
    document.body.innerHTML = `
      <div id="root">
        <section data-guide-title="A" data-guide="a"></section>
        <section data-guide-title="B" data-guide="b"></section>
        <section>undeclared</section>
      </div>`
    const root = document.getElementById('root')!
    // jsdom lays nothing out, so every rect is 0×0 — the engine's own visibility
    // filter is exercised in the BROWSER probe. Here the registry walk is what
    // is proven: the declared pair is what joins, and nothing else does.
    const declared = root.querySelectorAll('[data-guide]')
    expect(declared.length).toBe(2)
    expect(spotTargets(root).length).toBe(0)
  })

  it('the walk is a RING, and an empty registry has no step', () => {
    expect(wrapStep(3, 3)).toBe(0)
    expect(wrapStep(-1, 3)).toBe(2)
    expect(wrapStep(0, 0)).toBe(-1)
  })

  it('the SMALLEST declared region under the pointer wins', () => {
    const rects = [
      { left: 0, top: 0, width: 400, height: 400 },
      { left: 10, top: 10, width: 60, height: 60 },
    ]
    expect(spotHitIndex(30, 30, rects)).toBe(1)
    expect(spotHitIndex(300, 300, rects)).toBe(0)
    expect(spotHitIndex(900, 900, rects)).toBe(-1)
  })

  it('the room-local correction keeps the card off a full-width section’s heading', () => {
    // A section taller than the viewport has no free side, so the engine's last
    // resort puts the card over the thing it explains. This room's two
    // full-width lists are exactly that shape.
    const target = { left: 0, top: 0, width: 1200, height: 2000 }
    const card = { width: 300, height: 160 }
    const viewport = { width: 1280, height: 800 }
    const engine = spotCardAt(target, card, viewport)
    const fixed = keepCardOffHeading(engine, card, target, viewport)
    expect(fixed.top + card.height).toBeLessThanOrEqual(viewport.height)
    expect(fixed.top).toBeGreaterThan(64)
    // an ordinary step is returned UNTOUCHED
    const small = { left: 100, top: 100, width: 200, height: 80 }
    expect(keepCardOffHeading(spotCardAt(small, card, viewport), card, small, viewport)).toEqual(
      spotCardAt(small, card, viewport),
    )
  })
})

// ═══ ⚖ R6-D4 · THE DESIGN GATE ══════════════════════════════════════════════

describe('⚖ §2f — the phone is the DESIGN source, quoted rather than approximated', () => {
  it('the record button wears the phone’s own red family, by value', () => {
    // RecordButtonCard.tsx:96-98 — bg-red-500, hover red-600, shadow red-500/40,
    // the ended state's red-50/50 ground and red-400 ink.
    for (const [token, value] of [
      ['--rc-rec', '#ef4444'],
      ['--rc-rec-hover', '#dc2626'],
      ['--rc-rec-shadow', 'rgba(239, 68, 68, .4)'],
      ['--rc-rec-bar', 'rgba(239, 68, 68, .7)'],
      ['--rc-rec-ended-ink', '#f87171'],
      ['--rc-danger', '#dc2626'],
    ] as const) {
      expect(CSS_CODE).toContain(`${token}: ${value}`)
    }
  })

  it('ONE persistent button that MORPHS — never two controls swapped', () => {
    // exactly one <button> carries the record class, and the two glyphs
    // cross-fade INSIDE it
    expect([...SRC_CODE.matchAll(/className=\{`rc-rec\$/g)].length).toBe(1)
    expect([...SRC_CODE.matchAll(/rc-glyph/g)].length).toBe(2)
    expect(SRC_CODE).toContain('rc-stop-square')
  })

  it('the 0.34,1.56 OVERSHOOT is reserved for the press and the glyph morph ONLY', () => {
    const uses = [...CSS_CODE.matchAll(/var\(--rc-overshoot\)/g)].length
    expect(uses).toBe(2) // the button's own `scale`, and the glyph's
    // …and the property it is spent on is `scale`, never `transform` (the
    // phone's own note: Tailwind v4 compiles scale-* to the standalone
    // property, and transitioning `transform` leaves the morph snapping).
    for (const m of CSS_CODE.matchAll(/([a-z-]+)\s+\d+ms\s+var\(--rc-overshoot\)/g)) {
      expect(m[1]).toBe('scale')
    }
    expect(CSS_CODE).not.toMatch(/transition:[^;]*transform[^;]*--rc-overshoot/)
  })

  it('the waveform moves on transform: scaleY ONLY — composite-only, never height', () => {
    expect(SRC_CODE).toContain('transform: `scaleY(${v})`')
    expect(SRC_CODE).not.toMatch(/height: `\$\{/)
    // the bar keeps a FIXED height and scales from its own bottom
    expect(CSS_CODE).toMatch(/\.rc-bar \{[^}]*height: 100%/)
    expect(CSS_CODE).toMatch(/\.rc-bar \{[^}]*transform-origin: bottom/)
    // …and it is deliberately UNTRANSITIONED (the samples are already smoothed)
    expect(CSS_CODE).not.toMatch(/\.rc-bar \{[^}]*transition/)
  })

  it('the ended state DIMS and FREEZES the bars', () => {
    expect(CSS_CODE).toMatch(/\.rc-wave\.is-frozen \{[^}]*opacity: \.5/)
    expect(SRC_CODE).toContain('setFrozen(bars)')
  })

  it('the BREATHE keyframe is the house style for 「quietly live」, at its own numbers', () => {
    const kf = CSS_CODE.slice(CSS_CODE.indexOf('@keyframes rcBreathe'))
    const body = kf.slice(0, kf.indexOf('\n}') + 2)
    expect(body).toContain('0%, 100% { opacity: 1; scale: 1; }')
    expect(body).toContain('50% { opacity: .55; scale: .94; }')
    expect(CSS_CODE).toContain('animation: rcBreathe 3.2s ease-in-out infinite')
  })

  it('EVERY animation trigger is motion-safe-gated, and the dot stays SOLID', () => {
    const reduced = CSS_CODE.slice(CSS_CODE.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced.length).toBeGreaterThan(0)
    // every @keyframes this room defines is switched off for a reader who asked
    const names = [...CSS_CODE.matchAll(/@keyframes (\w+)/g)].map((m) => m[1])
    expect(names.sort()).toEqual(['rcBreathe', 'rcPing'])
    expect(reduced).toContain('animation: none')
    expect(reduced).toContain('transition: none')
    // the dot is still THERE — it simply stops moving (never hidden)
    expect(reduced).not.toMatch(/\.rc-dot[^}]*display: none/)
  })

  it('破棄済み is the QUIETEST chip — and no chip is a solid fill (⚖ R13)', () => {
    const chip = CSS_CODE.slice(CSS_CODE.indexOf('.rc-chip {'))
    const base = chip.slice(0, chip.indexOf('}') + 1)
    expect(base).toContain('--rc-quiet-bg')
    // the discarded chip states NO colour of its own — it takes the base
    expect(CSS_CODE).not.toMatch(/\.rc-chip\.is-discarded\s*\{/)
    // every chip's ground is a WASH token, never a saturated fill
    for (const t of ['--rc-saved-bg', '--rc-amber-bg', '--rc-blue-bg', '--rc-fail-bg', '--rc-quiet-bg']) {
      expect(CSS_CODE).toMatch(new RegExp(`${t}: #[0-9a-f]{6}`))
    }
  })

  it('⚖ R13 — no interactive element is black-filled, and solid accent = commit only', () => {
    // the two solid accent fills in the room are the two COMMITS
    const solids = [...CSS_CODE.matchAll(/background: var\(--rc-accent\)/g)].length
    expect(solids).toBe(2) // rc-recovery-save, rc-commit
    expect(CSS_CODE).not.toMatch(/background:\s*(#000|#18181b|var\(--ink\))/)
    // the selected/wash recipe is /8, never /10 (accent on /10 computes 4.49:1)
    expect(CSS_CODE).toContain('--rc-accent-wash: rgba(37, 99, 235, .08)')
  })

  it('the accent is R13’s #2563eb — never the shell’s indigo', () => {
    expect(CSS_CODE).toContain('--rc-accent: #2563eb')
    expect(CSS_CODE).not.toContain('var(--indigo)')
    expect(CSS_CODE).not.toContain('#3f5be8')
  })

  it('RED IS THE RECORD BUTTON’S COLOUR, never a verdict on a discard', () => {
    // ⚖ 8/25 ruling B: a completed discard is a plain fact — no red, no amber,
    // no grade. The review screen and the discarded row must carry neither.
    const review = CSS_CODE.slice(CSS_CODE.indexOf('.rc-review-rows'), CSS_CODE.indexOf('.rc-scrim'))
    expect(review).not.toMatch(/--rc-rec\b|--rc-danger|--rc-fail/)
    const row = CSS_CODE.slice(CSS_CODE.indexOf('.rc-row.is-discarded'))
    expect(row.slice(0, row.indexOf('}') + 1)).not.toMatch(/red|--rc-fail|--rc-amber/)
  })
})

// ═══ ⚖ ALL-SCREEN ADAPTIVITY, AND THE ≥44px SWEEP ═══════════════════════════

describe('⚖ ALL-SCREEN — the ladder and the thumb', () => {
  it('every band the law names has a block', () => {
    for (const q of [
      '@media (min-width: 1400px)',
      '@media (max-width: 1279px)',
      '@media (max-width: 1099px)',
      '@media (max-width: 1023px)',
      '@media (min-width: 800px) and (max-width: 1023px)',
      '@media (max-width: 743px)',
    ]) {
      expect(CSS_CODE).toContain(q)
    }
  })

  it('the ≥44px floor is SWEPT FLAT rather than listed control by control', () => {
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    // the blanket rule covers every `.btn` the room can render
    expect(phone).toMatch(/\.biz \.page\.pg-recording \.btn \{ min-height: 44px/)
    // …and the two controls that keep their own paint grow their HIT BOX
    expect(phone).toContain('.rc-help::after')
    expect(phone).toMatch(/width: 46px; height: 46px/)
  })

  it('the list becomes cards at phone width — no sideways drag to read a row', () => {
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    expect(phone).toContain('.rc-rowhead { display: none; }')
    expect(phone).toContain('grid-template-areas: "cust state" "date dur" "by act"')
  })

  it('THE SHELL’S 1180px FLOOR IS LIFTED FOR THIS ROOM (⚖ R6-1)', () => {
    // …from the room's OWN sheet, in the shell's own idiom, argued at the rule.
    expect(CSS_CODE).toContain('.biz .app:has(.page.pg-recording) { min-width: 0; }')
    expect(CSS).toContain('R6-1')
  })
})

// ═══ ⚖ 8/25 — THE NAV ITEM NEVER BLINKS WHILE THE DEMO RECORDS ══════════════

describe('⚖ 8/25 — a live-state indicator in a NAV bar never blinks', () => {
  it('the 録音 nav item is LIVE and is a plain Link — no animation, no badge', () => {
    expect(SIDEBAR).toContain("{ key: 'recording', segment: 'recording', label: '録音', mini: '録音', live: true },")
    // the ONLY badge the rail computes is 今日の運営's unresolved count
    expect(SIDEBAR).toContain("item.key === 'today' ?")
    expect(SIDEBAR).not.toMatch(/animate|blink|pulse|recording-indicator/i)
  })

  it('this room paints nothing outside its own root', () => {
    // No portal, no document-level class toggle, no body writes: the demo
    // machine is visible on THIS page and nowhere else in the shell.
    expect(SRC_CODE).not.toMatch(/createPortal|document\.body\.class|documentElement\.style/)
  })
})
