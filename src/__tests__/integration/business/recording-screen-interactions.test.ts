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

/** The room's own library — read here because F6-2's settle window is a NAMED
 *  constant with the argument on it, and the screen may only reference it. */
const LIB = readFileSync(join(process.cwd(), 'src/business/lib/recording.ts'), 'utf8')

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
const SRC_CODE = stripComments(SRC).replace(/^\s*\/\/.*$/gm, '')
const CSS_CODE = stripComments(CSS)
const LIB_CODE = stripComments(LIB).replace(/^\s*\/\/.*$/gm, '')

/** ⚠ A DECLARATION'S TEXT MAY BE ASSEMBLED RATHER THAN WRITTEN, and exactly one
 *  of them is (B1-9): the HEAD's sentence names 破棄の記録 only to a reader who
 *  can open it, so it is derived in `recording-props.ts` and arrives as a prop.
 *  The census counts it like every other declaration and marks it `derived`, and
 *  its CONTENT is pinned where it is built (`recording.test.ts` — both personas'
 *  wording, and the promise matched against the access). Silently dropping it
 *  would let a section stop declaring itself by turning its text into an
 *  expression, which is the hole this census exists to close. */
type Declaration = { title: string; text: string; derived: boolean; at: number }
const DECLARATIONS: Declaration[] = [
  ...SRC_CODE.matchAll(/data-guide-title="([^"]*)"\s*\n\s*data-guide=(?:"([^"]*)"|\{([^}]+)\})/g),
].map((m) => ({ title: m[1], text: m[2] ?? m[3], derived: m[2] === undefined, at: m.index ?? 0 }))

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
    expect(DECLARATIONS.length).toBe([...SRC_CODE.matchAll(/data-guide[=]/g)].length)
    for (const d of DECLARATIONS) {
      expect(d.title.trim().length).toBeGreaterThan(0)
      // a DERIVED one carries an expression here; its wording is pinned where it
      // is assembled, and the browser probe reads what actually landed in the DOM
      expect(d.text.trim().length).toBeGreaterThan(d.derived ? 0 : 20)
    }
    expect(new Set(DECLARATIONS.map((d) => d.title)).size).toBe(DECLARATIONS.length)
    // ⚠ EXACTLY ONE is derived, and it is the head's (B1-9). A second one
    // appearing without an argument is a section quietly leaving the literal
    // census.
    expect(DECLARATIONS.filter((d) => d.derived).map((d) => d.title)).toEqual(['録音'])
    expect(DECLARATIONS.find((d) => d.derived)!.text.trim()).toBe('props.headGuide')
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
    // the DERIVED one's text is an expression here; the same scan runs on the
    // strings it assembles, in `recording.test.ts`, where they exist
    const all = DECLARATIONS.filter((d) => !d.derived).map((d) => `${d.title} ${d.text}`).join(' ')
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

  it('the ended state DIMS and FREEZES the bars — on scaleY too', () => {
    expect(CSS_CODE).toMatch(/\.rc-wave\.is-frozen \{[^}]*opacity: \.5/)
    expect(SRC_CODE).toContain('setFrozen(bars)')
    // ⚠ B3-6 — THE FROZEN WAVE GETS ITS OWN ASSERTION. The composite-only pin
    // above matched BOTH renders of the bar span, so the live and the frozen
    // mutant shared one killer and neither proved the other's site. This reads
    // the FROZEN map alone.
    expect(SRC_CODE).toMatch(/\{frozen\.map\([\s\S]{0,160}transform: `scaleY\(/)
    expect(SRC_CODE).not.toMatch(/\{frozen\.map\([\s\S]{0,160}height: `/)
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
    // the THREE solid accent fills in the room are the three COMMIT-SHAPED
    // controls: the recovery banner's 保存する, the use confirm's この録音を使う,
    // and the 復元可能 row's 保存する — the phone's own solid tier
    // (RecordingsInboxCard's SOLID_BTN), shown at its real weight and REFUSED
    // (the ＋新規カルテ pattern). Hiding what the room WOULD do is what makes a
    // refusal unreadable (⚖ 47).
    const solids = [...CSS_CODE.matchAll(/background: var\(--rc-accent\)/g)].length
    expect(solids).toBe(3) // rc-recovery-save, rc-commit, rc-row-save
    for (const cls of ['.rc-recovery-save', '.rc-commit', '.rc-row-save']) {
      expect(CSS_CODE).toMatch(new RegExp(`\\${cls} \\{[^}]*background: var\\(--rc-accent\\)`, 's'))
    }
    // …and all three ARE commits: two of them refuse, and the third opens the
    // confirm whose commit refuses.
    // the banner's label is BRANCHED (B1-11: an unbound take is told to pick a
    // customer first) — what is not branched is the refusal it carries
    expect(SRC_CODE).toContain("refused(recovery.saveLabel, props.refusals.save, { className: 'rc-recovery-save' })")
    expect(SRC_CODE).toContain("refused(t.action.label, props.refusals.save, { className: 'rc-row-save' })")
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
  it('⚖ THE COLUMN LADDER IS KEYED TO THE PAGE, AND IT IS MONOTONIC BY CONSTRUCTION', () => {
    // ⚠ THE DEFECT THIS REPLACED. The rail is 264px at ≥1024 with the sidebar
    // open and 76px everywhere else, so PAGE WIDTH FALLS BY 187px as the
    // viewport crosses 1024. Deciding a COLUMN COUNT from the viewport therefore
    // ran two columns on a 724px page (viewport 820) and ONE column on a 948px
    // page (viewport 1024 with the rail collapsed) — and a 1px drag across
    // 1023→1024 flipped the recorder.
    //
    // The wrappers are now containers and every column rule queries THEM, so a
    // layout can no longer be chosen from a width the layout does not have.
    expect(CSS_CODE).toContain('container-type: inline-size; container-name: rcpage;')
    // …declared on the two page wrappers, and on nothing else.
    const containers = [...CSS_CODE.matchAll(/([^{}]+)\{[^{}]*container-type/g)].map((m) => m[1].trim())
    expect(containers.length).toBe(1)
    expect(containers[0]).toBe('.biz .pg-recording .rc-record-view,\n.biz .pg-recording .rc-review-view')
    // ⚠ NO COLUMN COUNT IS DECIDED BY A MEDIA QUERY ANY MORE. Every
    // `grid-template-columns` / `grid-template-areas` in the sheet sits either at
    // base level or inside a `@container` — never inside an `@media`.
    for (const m of CSS_CODE.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)) {
      const band = m[0].slice(0, m[0].indexOf('{'))
      // the phone band legitimately stacks the room's DEFINITION lists (a label
      // over its value is a composition, not a column count on the take list)
      const offenders = [...m[1].matchAll(/([^{};]+)\{[^{}]*grid-template-(columns|areas)/g)]
        .map((x) => x[1].trim())
        .filter((sel) => !/rc-trace-row|rc-receipt|rc-target|rc-defs/.test(sel))
      expect({ band: band.trim(), offenders }).toEqual({ band: band.trim(), offenders: [] })
    }
    // the bands that remain on the VIEWPORT are the ones that genuinely belong
    // to the device: the page's own padding, the shape notes, and the thumb.
    for (const q of [
      '@media (min-width: 1400px)',
      '@media (max-width: 1279px)',
      '@media (max-width: 1023px)',
      '@media (max-width: 743px)',
      '@media (prefers-reduced-motion: reduce)',
    ]) {
      expect(CSS_CODE).toContain(q)
    }
    // …and the container ladder itself, one threshold per step, ascending.
    const thresholds = [...CSS_CODE.matchAll(/@container rcpage \((min|max)-width: (\d+)px\)/g)].map((m) => Number(m[2]))
    expect(thresholds.length).toBeGreaterThanOrEqual(8)
  })

  it('the ≥44px floor is SWEPT FLAT rather than listed control by control', () => {
    const phone = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 743px)'))
    // the blanket rule covers every `.btn` the room can render
    expect(phone).toMatch(/\.biz \.page\.pg-recording \.btn \{ min-height: 44px/)
    // …and the two controls that keep their own paint grow their HIT BOX
    expect(phone).toContain('.rc-help::after')
    expect(phone).toMatch(/width: 46px; height: 46px/)
  })

  it('the list becomes cards under a 790px PAGE — no sideways drag to read a row', () => {
    // ⚠ 790 OF PAGE, NOT 900 OF VIEWPORT. Six columns need about 790px of page
    // to stay readable; keying that off the viewport meant a 1024-wide window
    // with the rail OPEN — a 760px page, NARROWER than the 824px page a 900px
    // window gets — kept all six columns and squeezed 録音者 to two characters.
    const at = CSS_CODE.indexOf('@container rcpage (max-width: 789px)')
    expect(at).toBeGreaterThan(0)
    const cards = CSS_CODE.slice(at, CSS_CODE.indexOf('@container', at + 10))
    expect(cards).toContain('.rc-rowhead { display: none; }')
    expect(cards).toContain('grid-template-areas: "cust state" "date dur" "by act" "reason reason"')
    // …and the reason is its OWN spanning line at EVERY band, never a child of
    // the state cell whose sentence would size that cell's track.
    expect(CSS_CODE).toContain('". reason reason reason reason reason"')
  })

  it('⚖ F-R1 — the 1180px floor is lifted from the SHELL’s own list, and NOT from this sheet', () => {
    const shell = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business-shell.css'), 'utf8')
    expect(shell).toContain('.page.pg-karute, .page.pg-recording) { min-width: 0; }')
    expect(CSS_CODE).not.toContain('.biz .app:has')
  })

  it('⚖ 8/31 — the transcript reads in a BOUNDED panel, and it is the room’s only scroller', () => {
    // A 47-minute take must cost the page no height at all: sticky header,
    // 5分 markers derived from the words' own clock, a fade at each edge and a
    // bar that is always visible (macOS hides overlay bars).
    expect(CSS_CODE).toMatch(/\.rc-tscroll \{[^}]*max-height: 420px/)
    expect(CSS_CODE).toMatch(/\.rc-tscroll \{[^}]*overflow-y: auto/)
    expect(CSS_CODE).toMatch(/\.rc-tscroll \{[^}]*overscroll-behavior: contain/)
    expect(CSS_CODE).toMatch(/\.rc-tpanel-head \{[^}]*position: sticky/)
    expect(CSS_CODE).toContain('.rc-tscroll::-webkit-scrollbar-thumb')
    // it is a keyboard-reachable REGION, or a scroller is mouse-only
    expect(SRC_CODE).toContain('className="rc-tscroll"')
    expect(SRC_CODE).toMatch(/rc-tscroll[\s\S]{0,200}tabIndex=\{0\}/)
    expect(SRC_CODE).toMatch(/rc-tscroll[\s\S]{0,220}aria-label="文字起こし（全文）"/)
  })

  it('⚖ MASTER–DETAIL — ONE DOM, and the phone column is the same markup reflowed', () => {
    // Rendering the detail twice would be two copies of one heading, two tour
    // steps for one thing, and two places to fix. `display: contents` hoists the
    // rows into the stacked column so each row's `order` can place the detail
    // directly beneath the row it belongs to.
    expect([...SRC_CODE.matchAll(/rc-pane-detail/g)].length).toBe(1)
    expect(CSS_CODE).toMatch(/\.rc-pane-list \{ display: contents; \}/)
    expect(CSS_CODE).toMatch(/@container rcpage \(min-width: 930px\)/)
    expect(SRC_CODE).toContain('style={{ order: i * 2 }}')
    expect(SRC_CODE).toContain('style={{ order: i * 2 + 1 }}')
  })

  it('⚖ 8/25 A — the master list may only ARRIVE where the two equal cards still fit (V-2)', () => {
    // ⚠ THE DEFECT THIS REPLACED, and it was a WRONG CONSTANT rather than a
    // wrong design: the panes rule always claimed 「a detail wide enough for the
    // two labelled cards」 and opened at a 820px container, where the detail pane
    // is 434px — one card wide. So the list arriving pushed `.rc-detail-cols`
    // back below its own 260px floor: page 859 two cards, page 860 ONE, two
    // again at 964. Dragging the window WIDER lost the ruling's shape.
    //
    // A literal (「the threshold is 930」) would go stale the moment the list
    // track, the pane's padding or the card floor moved. This reads all four
    // numbers OUT OF THE SHEET and asserts the threshold against their SUM, so
    // widening the list without moving the threshold fails here.
    const threshold = Number(
      /@container rcpage \(min-width: (\d+)px\) \{\s*\n\s*\.biz \.pg-recording \.rc-panes \{/.exec(CSS_CODE)![1],
    )
    const listTrack = Number(
      /\.rc-panes \{ display: grid; grid-template-columns: minmax\(0, (\d+)px\)/.exec(CSS_CODE)![1],
    )
    const detailPad = Number(/\.rc-pane-detail \{ padding: \d+px (\d+)px/.exec(CSS_CODE)![1])
    const cardFloor = Number(
      /\.rc-detail-cols \{[^}]*minmax\(min\((\d+)px, 100%\), 1fr\)\)/.exec(CSS_CODE)![1],
    )
    const gap = Number(/\.rc-detail-cols \{[^}]*gap: (\d+)px/.exec(CSS_CODE)![1])
    // 340 list + 2 panes borders + 44 detail padding + (260 + 260 + 16) cards
    const fits = listTrack + 2 + detailPad * 2 + cardFloor * 2 + gap
    expect({ listTrack, detailPad, cardFloor, gap, fits }).toEqual({
      listTrack: 340, detailPad: 22, cardFloor: 260, gap: 16, fits: 922,
    })
    expect(threshold).toBeGreaterThanOrEqual(fits)
    // …and the excerpt clamp defers to 「the pane beside it」, so it may not begin
    // one pixel before that pane exists.
    const clamp = Number(
      /@container rcpage \(min-width: (\d+)px\) \{\s*\n\s*\.biz \.pg-recording \.rc-review-reason \{ white-space: nowrap/.exec(CSS_CODE)![1],
    )
    expect(clamp).toBe(threshold)
  })
})

// ═══ F6 · THE TWO INTERACTION DEFECTS A RUSHED RECEPTIONIST MEETS ══════════

describe('F6 — the gestures that used to undo themselves', () => {
  // ⚠ FOUR TRUTHS, FOUR TESTS (the B3-6 lesson): a shared killer proves no site.

  it('⚖ F6-2 — the backdrop closes on a DECISION, and the gate lives in the ONE Overlay', () => {
    // ONE scrim in the whole room, so all three dialogs inherit the same rule
    // rather than three openers each carrying their own guard.
    expect([...SRC_CODE.matchAll(/className="rc-scrim"/g)].length).toBe(1)
    expect([...SRC_CODE.matchAll(/<Overlay /g)].length).toBe(3)
    // the scrim's click is GATED on how long the panel has been on screen
    expect(SRC_CODE).toMatch(/className="rc-scrim"\s+onClick=\{\(\) => \{ if \(Date\.now\(\) - openedAt\.current >= SCRIM_SETTLE_MS\) onClose\(\) \}\}/)
    // …and it starts FAIL-CLOSED: the backdrop refuses every press until a
    // layout effect has stamped the moment the panel was laid out.
    expect(SRC_CODE).toContain('const openedAt = useRef(Number.POSITIVE_INFINITY)')
    expect(SRC_CODE).toContain('useLayoutEffect(() => { openedAt.current = Date.now() }, [])')
    // …and the gate is the LIBRARY's named constant, never a literal here
    expect(SRC_CODE).not.toMatch(/rc-scrim[\s\S]{0,160}\d{3}\)/)
    // Escape and cancel are UNTOUCHED — this delays the one exit that can be
    // taken by accident, and closing every exit would be a different product.
    expect(SRC_CODE).toMatch(/key === 'Escape'/)
    expect(SRC_CODE).not.toMatch(/Escape[\s\S]{0,120}SCRIM_SETTLE_MS/)
  })

  it('⚖ F6-2 — the settle window is the PLATFORM’s own double-click interval', () => {
    // 500ms is the macOS and Windows default double-click interval, so the
    // window in which a second press can still belong to the first gesture is
    // covered by construction rather than by a number chosen to fit a test.
    expect(LIB_CODE).toContain('export const SCRIM_SETTLE_MS = 500')
  })

  it('⚖ F6-3 — starting a take clears the recorder’s receipt, and ONLY the recorder’s', () => {
    // the record button's START branch, from `setElapsed(0)` to `setPhase`
    const at = SRC_CODE.indexOf("if (!consentOk) return")
    const start = SRC_CODE.slice(at, SRC_CODE.indexOf("setPhase('recording')", at))
    expect(start).toContain("setReceipt((r) => (r?.of === 'recovery' ? r : null))")
    // …the SAME predicate the picker effect uses: the recovery residue's receipt
    // belongs to no take at all and survives both exits.
    expect([...SRC_CODE.matchAll(/setReceipt\(\(r\) => \(r\?\.of === 'recovery' \? r : null\)\)/g)].length).toBe(2)
    // and it is NOT inside `reset()`, which fires one line AFTER the receipt is
    // minted — putting it there would wipe the receipt the discard just wrote.
    const reset = SRC_CODE.slice(SRC_CODE.indexOf('const reset = () => {'))
    expect(reset.slice(0, reset.indexOf('\n  }'))).not.toContain('setReceipt')
  })

  it('⚖ F6-4 — the counts band WRAPS, and only the number refuses to break', () => {
    // `white-space: nowrap` on the entry defeated the `overflow-wrap: anywhere`
    // beside it — the two rules contradict — and a 32-character name pushed the
    // whole PAGE sideways at 390. Kana too: nowrap disables CJK breaking.
    const entry = /\.rc-summary-one \{([^}]*)\}/.exec(CSS_CODE)![1]
    expect(entry).toContain('overflow-wrap: anywhere')
    expect(entry).not.toContain('nowrap')
    expect(CSS_CODE).toContain('.rc-summary-one .rc-num { white-space: nowrap; }')
  })
})

// ═══ CANON'S BOUNDARY MOUNT — PRESENT AND INERT ════════════════════════════

describe('the boundary panel (⚖ the 8/24 TYPE-TIER doctrine line)', () => {
  // ⚠ B3-6 — TWO TRUTHS, TWO TESTS. 「one mount, both variants」 and 「it is
  // inert」 used to be asserted by a single `it()`, so the two mutants that break
  // them shared one killer and neither proved its own site.
  it('is ONE mount carrying BOTH variants', () => {
    const block = SRC_CODE.slice(SRC_CODE.indexOf('rc-boundary'), SRC_CODE.indexOf('</div>', SRC_CODE.indexOf('rc-boundary')))
    // one mount, not two
    expect([...SRC_CODE.matchAll(/rc-boundary/g)].length).toBe(1)
    // both product states are spelled out
    expect(block).toContain('data-variant="entitlement"')
    expect(block).toContain('data-variant="rights"')
    expect(block).toContain('Karute プラン')
    expect(block).toContain('録音の記録権限')
  })

  it('…and the boundary mount is INERT — no paint, no space, no tour step, no keyboard', () => {
    const block = SRC_CODE.slice(SRC_CODE.indexOf('rc-boundary'), SRC_CODE.indexOf('</div>', SRC_CODE.indexOf('rc-boundary')))
    expect(SRC_CODE).toContain('<div className="rc-boundary" hidden aria-hidden="true"')
    expect(block).not.toContain('data-guide')
    expect(block).not.toMatch(/<button|<a |href=/)
  })

  it('⚖ 8/17 — it is DISCONNECTED: no flag in this room chooses between the variants', () => {
    // A speculative surface ships off and reconnects on Liam's word; registry ⑨
    // owns the switch. A room-invented flag would be the depth-grant the 8/17
    // ruling overturned.
    expect(SRC_CODE).not.toMatch(/entitlement\s*[?&|=]|hasRecordingPlan|canRecordCapability/)
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
