/**
 * @jest-environment jsdom
 *
 * ⚖ Liam 2026-09-11 evening — THE ⇄ BADGE'S WORD STEPS ASIDE ON A NARROW CARD.
 *
 * 「You can add the word, but if not just use the icon … depending on the screen
 * size … just make it respond smartly, depending on the room, the spacing, and
 * the screen size.」 So the badge on the card in hand is ALWAYS the ⇄ icon and the
 * word (入れ替え / 要確認) joins it only when the CARD ITSELF has room for it.
 *
 * `cursorWord` still composes the whole text — the engine's spelling, ⚖ H8's
 * identity (aimed chip ≡ word ≡ drop), and the five-row table pinned in
 * today-live-drag.test.ts §M4 are all untouched. Two things are new and both are
 * pinned here: `dressBadge` splits that ONE text into two nodes, and today.css
 * hides the word below the card's own inline size.
 *
 * This file exists apart from today-live-drag.test.ts for one reason: the unit
 * pin below needs real DOM nodes and that suite runs `node` (jest.config's
 * default, no docblock), which the rest of its 40 pins depend on. The CSS/text
 * pins ride here with it so the whole rule has one home.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cursorWord, VERDICT_WORD, type LandingVerdict } from '@/app/[locale]/(business)/business/today/today-interactions'
import { dressBadge } from '@/app/[locale]/(business)/business/today/TodayScreen'

const TODAY = 'src/app/[locale]/(business)/business/today'
const SCREEN = readFileSync(join(process.cwd(), TODAY, 'TodayScreen.tsx'), 'utf8')
const CSS = readFileSync(join(process.cwd(), TODAY, 'today.css'), 'utf8')

const verdictOf = (kind: LandingVerdict['kind'], reseats: LandingVerdict['reseats'] = []): LandingVerdict => ({
  kind,
  floor: null,
  label: VERDICT_WORD[kind],
  reason: null,
  cell: null,
  bedLane: null,
  checks: [],
  reseats,
})

const RESEAT = [{ id: 'other', from: 'bed-0', to: 'bed-1' }] as const

/** The five rows of §M4's table, as the badge receives them. */
const ROWS: ReadonlyArray<readonly [string, LandingVerdict | null]> = [
  ['nothing at all', null],
  ['a clean landing', verdictOf('clean')],
  ['要確認', verdictOf('caution')],
  ['置けない', verdictOf('blocked')],
  ['⇄ 入れ替え', verdictOf('clean', RESEAT)],
  ['⇄ 要確認', verdictOf('caution', RESEAT)],
]

describe('⚖ 9/11 — `dressBadge`: the icon always, the word only when the card has room', () => {
  it('the ⇄ rows are TWO nodes and every other row is the text it always was', () => {
    // The slice is by UTF-16 unit, so the assumption is checked rather than
    // assumed: ⇄ is U+21C4, one unit, and `text.slice(1)` therefore carries the
    // space with the word.
    expect('⇄'.length).toBe(1)
    for (const [name, v] of ROWS) {
      const node = document.createElement('i')
      const { text, kind } = cursorWord(v)
      dressBadge(node, text, kind)
      // Whatever the shape, the badge SAYS exactly what the engine composed —
      // the word is hidden by CSS, never dropped from the DOM, so the accessible
      // text and every existing text pin stay byte-equal.
      expect({ name, said: node.textContent }).toEqual({ name, said: text })
      expect({ name, verdict: node.dataset.verdict }).toEqual({ name, verdict: kind })
      if (kind === 'reseat' || kind === 'reseat-caution') {
        expect({ name, shape: [...node.children].map((c) => c.tagName) }).toEqual({ name, shape: ['B', 'SPAN'] })
        expect({ name, icon: node.children[0].textContent }).toEqual({ name, icon: '⇄' })
        // The space rides with the WORD: hiding the span must not leave the icon
        // trailing a space inside the badge's padding.
        expect({ name, word: node.children[1].textContent?.startsWith(' ') }).toEqual({ name, word: true })
      } else {
        expect({ name, shape: [...node.children].map((c) => c.tagName) }).toEqual({ name, shape: [] })
      }
    }
  })

  it('a node is DRESSED AGAIN cleanly — the badge is written every aim change', () => {
    // `wearVerdict` writes the same node for the life of the gesture, so the
    // two-node shape has to survive going back and forth between the rows.
    const node = document.createElement('i')
    const wear = (v: LandingVerdict | null) => {
      const { text, kind } = cursorWord(v)
      dressBadge(node, text, kind)
    }
    wear(verdictOf('clean', RESEAT))
    wear(verdictOf('blocked'))
    expect(node.textContent).toBe('置けない')
    expect(node.children).toHaveLength(0)
    wear(verdictOf('caution', RESEAT))
    expect(node.textContent).toBe('⇄ 要確認')
    expect(node.children).toHaveLength(2)
  })

  it('the screen writes the badge through that ONE function, and nowhere else', () => {
    expect(SCREEN).toContain('    const { text, kind } = cursorWord(v)\n    dressBadge(node, text, kind)\n')
    // One definition, one call. A second caller — or the old direct
    // `node.textContent = text` growing back beside it — fails here.
    expect((SCREEN.match(/dressBadge\(/g) ?? [])).toHaveLength(2)
  })

  it('…and the CSS is what decides how much of it is on screen, by the CARD’s own width', () => {
    // The query is on the PROXY, not the viewport: a 30分 card is narrow on a
    // 1440 screen too. Without `container-type` the query has nothing to measure
    // and the word simply never appears.
    // ⚖ FIX ROUND 3 (DELTA-CODE-D1 MINOR 2) — BOTH SELECTORS, AS ONE STRING.
    // The rule is a two-selector list and this pin held only the second half,
    // so deleting `.biz .event.drag-proxy,` left every badge pin green — and
    // with the CARD no longer a container, the unnamed `@container` query has
    // no eligible ancestor, the `display: inline` rule never matches, and
    // 「⇄ 入れ替え」 never appears on a card at any width. That is the whole of
    // ⚖ 9/11 evening's ruling, silently off, whole battery green. (1B's own
    // mutant deleted the WHOLE rule and went red; the half-deletion survived.)
    expect(CSS).toContain('.biz .event.drag-proxy,\n.biz .drag-proxy.chip { container-type: inline-size; }')
    expect(CSS).toContain('.biz .proxy-verdict > span { display: none; }')
    // 82px, not 92: a container query is asked in the container's CONTENT box and
    // the card is `box-sizing: border-box` with a 1px border and 2px/6px side
    // padding, so 82px here IS the 92px CARD the rule is written about. Measured,
    // not assumed — at 92px of card the word appears and at 91px it does not
    // (harness/badge-1b).
    expect(CSS).toContain('@container (min-width: 82px) { .biz .proxy-verdict > span { display: inline; } }')
    // …and the icon is never hidden with it: the rule names `> span` alone.
    expect(CSS).not.toContain('.biz .proxy-verdict > b { display: none; }')
  })
})
