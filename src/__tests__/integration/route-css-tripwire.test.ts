/**
 * ⚖ Liam flag 69 (2026-08-22) — the route-CSS collision tripwire's own pins.
 *
 * These assertions were written beside the flag-69 fix, inside the Business
 * interactions suite. They could not stay there: the guard, its CI step and its
 * npm script are SHARED files, so the Business isolation gate sends them to this
 * PR — and a test that reads three files cannot live on the branch that no
 * longer carries them. They could not ride along in the Business suite either,
 * because that directory IS Business territory and carrying it here would make
 * this PR a Business PR and re-trip the very gate that caused the split.
 *
 * So they live here, outside territory, next to the thing they pin.
 *
 * TWO TIERS, on purpose (Greptile P2 on this PR):
 *
 *  - BEHAVIOURAL pins drive the guard's exported core on fixtures. They are the
 *    ones that matter: a regression that kept every string this file greps for
 *    but lost the detection would sail past source-text assertions AND past a
 *    clean-tree CI run, because a clean tree is green either way. Breaking the
 *    at-rule transparency or the comma split turns these red.
 *  - WIRING pins read source text, because "is this step in ci.yml" has no
 *    runtime to observe. They never run the guard against the real tree: #753
 *    scoped the colliding sheets so main is clean today, but a test that shelled
 *    out would track the tree's collision state instead of the one thing it
 *    means to pin — that the tripwire is wired and still has teeth.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  routeSheets,
  findCollisions,
} from '../../../scripts/audit/check-route-css-collisions.mjs'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const sheet = (path: string, css: string) => ({ path, css })

describe('the tripwire detects what it claims to detect', () => {
  it('names BOTH sheets when two of them define the same selector', () => {
    expect(
      findCollisions([
        sheet('today.css', '.biz .workspace { display: grid; }'),
        sheet('reservations.css', '.biz .workspace { display: flex; }'),
      ]),
    ).toEqual([['.biz .workspace', ['today.css', 'reservations.css']]])
  })

  it('passes sheets that scope BOTH sides to their own page class', () => {
    expect(
      findCollisions([
        sheet('today.css', '.biz .page-today .workspace { display: grid; }'),
        sheet('reservations.css', '.biz .page-reservations .workspace { display: flex; }'),
      ]),
    ).toEqual([])
  })

  it('sees selectors nested inside @media, which a naive parser would miss', () => {
    // At-rules are transparent containers: the collision is just as real at
    // 768px as at any width, and this is exactly where it hides from review.
    expect(
      findCollisions([
        sheet('today.css', '@media (min-width: 768px) { .biz .board { gap: 8px; } }'),
        sheet('reservations.css', '.biz .board { gap: 12px; }'),
      ]),
    ).toEqual([['.biz .board', ['today.css', 'reservations.css']]])
  })

  it('does not call two sheets\u2019 KEYFRAME STOPS a collision \u2014 and still sees the rules after them', () => {
    // \u26a0 A keyframe stop is namespaced by its animation\u2019s own name: two rooms
    // both writing `0%` collide over nothing. The parser used to walk into the
    // block and count every stop as a selector, so the day 今日の運営 shipped
    // `wc-settle` the gate failed against 録音\u2019s `rcBreathe`. The rule AFTER the
    // block must still be seen \u2014 a skip that swallows its closing brace would
    // blind the guard to the rest of the sheet, which is the worse failure.
    expect(
      findCollisions([
        sheet('today.css', '@keyframes wc-settle { 0% { opacity: 1; } 100% { opacity: 1; } }\n.biz .page-today .hold { color: red; }'),
        sheet('recording.css', '@keyframes rcBreathe { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }\n.biz .page-recording .hold { color: blue; }'),
      ]),
    ).toEqual([])
    expect(
      findCollisions([
        sheet('today.css', '@keyframes a { 0% { opacity: 1; } }\n.biz .workspace { display: grid; }'),
        sheet('recording.css', '@keyframes b { 0% { opacity: 1; } }\n.biz .workspace { display: flex; }'),
      ]),
    ).toEqual([['.biz .workspace', ['today.css', 'recording.css']]])
  })

  it('reads a quoted brace as CONTENT, so a `content: "{"` cannot blind the guard', () => {
    // ⚠ Greptile on the flag-69 parser PR: `{` and `}` also appear inside
    // STRINGS, and the walker counted them as structure. A single `content: "{"`
    // in a keyframe stop left framesDepth permanently positive, so every rule
    // after that block — the whole rest of the sheet — was skipped in silence.
    // Silence is the failure mode this guard exists to prevent.
    expect(
      findCollisions([
        sheet('today.css', '@keyframes a { 0% { content: "{"; opacity: 1; } }\n.biz .workspace { display: grid; }'),
        sheet('recording.css', '.biz .workspace { display: flex; }'),
      ]),
    ).toEqual([['.biz .workspace', ['today.css', 'recording.css']]])
  })

  it('reads a quoted `}` as CONTENT, so it ends neither a rule nor a @keyframes block early', () => {
    // The mirror of the above: a stray closing brace ends things too EARLY. In an
    // attribute selector it splits the head, so the real selector is lost and a
    // fragment is recorded in its place; inside @keyframes it drops the depth to
    // zero and turns the remaining stops into "selectors" — the exact false
    // collision the flag-69 fix removed, walked back in through a string.
    expect(
      findCollisions([
        sheet('today.css', '.biz [data-guide="}"] .board { gap: 8px; }'),
        sheet('reservations.css', '.biz [data-guide="}"] .board { gap: 12px; }'),
      ]),
    ).toEqual([['.biz [data-guide="}"] .board', ['today.css', 'reservations.css']]])
    expect(
      findCollisions([
        sheet('today.css', '@keyframes a { 0% { content: "}"; } 50% { opacity: .5; } }'),
        sheet('recording.css', '@keyframes b { 0% { opacity: 1; } 50% { opacity: .5; } }'),
      ]),
    ).toEqual([])
    // Unquoted url(...) is the third place structure characters are content.
    expect(
      findCollisions([
        sheet('today.css', '.biz .a { background: url(data:image/svg+xml,<svg><style>i{fill:red}</style></svg>); }\n.biz .board { gap: 8px; }'),
        sheet('reservations.css', '.biz .board { gap: 12px; }'),
      ]),
    ).toEqual([['.biz .board', ['today.css', 'reservations.css']]])
  })

  it('reads an ESCAPED `)` in an unquoted url() as CONTENT, so the paren does not close early', () => {
    // ⚠ Greptile on this PR: inside `url(...)` a backslash-escaped `\)` was
    // counted as a real closing paren, so the walker left url state mid-value
    // and read the `{` behind it as STRUCTURE — recording the declaration
    // itself (`background: url(data:image/svg+xml,…<style>i`) as a selector in
    // BOTH sheets, which is a false collision on text no room wrote as a rule.
    // The real selector after the block must still be the ONLY thing reported.
    expect(
      findCollisions([
        sheet('today.css', '.biz .page-today .icon { background: url(data:image/svg+xml,<svg><text>\\)</text><style>i{fill:red}</style></svg>); }\n.biz .board { gap: 8px; }'),
        sheet('reservations.css', '.biz .page-reservations .icon { background: url(data:image/svg+xml,<svg><text>\\)</text><style>i{fill:red}</style></svg>); }\n.biz .board { gap: 12px; }'),
      ]),
    ).toEqual([['.biz .board', ['today.css', 'reservations.css']]])
  })

  it('reads an ESCAPED quote inside a string as CONTENT, so the string does not end early', () => {
    // The same escape rule on the other body: `\"` inside a quoted attribute
    // value keeps the string open, so the `}` after it stays content and the
    // whole head survives as one selector.
    expect(
      findCollisions([
        sheet('today.css', '.biz [data-guide="a\\"}"] .board { gap: 8px; }'),
        sheet('reservations.css', '.biz [data-guide="a\\"}"] .board { gap: 12px; }'),
      ]),
    ).toEqual([['.biz [data-guide="a\\"}"] .board', ['today.css', 'reservations.css']]])
  })

  it('does not report an @media HEAD shared by two sheets as a collision', () => {
    // Every room has a 768px breakpoint. If the at-rule head were recorded as a
    // selector, that shared head would be a false collision in almost every PR
    // — the failure mode that gets a noisy guard deleted.
    expect(
      findCollisions([
        sheet('today.css', '@media (min-width: 768px) { .biz .page-today .board { gap: 8px; } }'),
        sheet('reservations.css', '@media (min-width: 768px) { .biz .page-reservations .board { gap: 12px; } }'),
      ]),
    ).toEqual([])
  })

  it('splits selector lists, so a shared MEMBER of a group still collides', () => {
    expect(
      findCollisions([
        sheet('today.css', '.biz .board, .biz .rail { gap: 8px; }'),
        sheet('reservations.css', '.biz .rail { gap: 12px; }'),
      ]),
    ).toEqual([['.biz .rail', ['today.css', 'reservations.css']]])
  })
})

describe('the shell sheet is excluded by construction, not by name', () => {
  it('walks nested route sheets, drops the sheet sitting at the root, and does not call a shell overlap a collision', () => {
    const biz = mkdtempSync(join(tmpdir(), 'routecss-'))
    // The ONE shared home, at the root — excluded: a route sheet overriding it
    // is the intended layering.
    writeFileSync(join(biz, 'business-shell.css'), '.biz .workspace { display: grid; }')
    mkdirSync(join(biz, 'business/today'), { recursive: true })
    writeFileSync(join(biz, 'business/today/today.css'), '.biz .workspace { display: flex; }')
    // A room the guard has never heard of: found because the walker globs.
    mkdirSync(join(biz, 'business/a-room-shipped-tomorrow'), { recursive: true })
    writeFileSync(join(biz, 'business/a-room-shipped-tomorrow/room.css'), '.biz .rail { gap: 4px; }')

    const sheets: string[] = routeSheets(biz)
    expect(sheets.map((f) => f.slice(biz.length + 1)).sort()).toEqual([
      'business/a-room-shipped-tomorrow/room.css',
      'business/today/today.css',
    ])

    // `.biz .workspace` is in the shell AND in one route sheet — that is the
    // intended layering, so it must NOT be reported.
    expect(findCollisions(sheets.map((f) => sheet(f, readFileSync(f, 'utf8'))))).toEqual([])
  })
})

describe('the route-CSS collision tripwire is wired, and globs the family', () => {
  it('globs every (business) route sheet rather than naming today/reservations/customers', () => {
    // The 売上分析 room merged onto main while the flag-69 branch was open. A
    // guard that named three files would have missed it, and every room after
    // it. This is the pin that keeps the guard from quietly narrowing to a list.
    const guard = read('scripts/audit/check-route-css-collisions.mjs')
    expect(guard).toContain('readdirSync')
    expect(guard).not.toMatch(/'today\.css'|"today\.css"/)
    expect(guard).not.toMatch(/'reservations\.css'|"reservations\.css"/)
  })

  it('runs where the other machine-diff gates run, and by hand', () => {
    expect(read('.github/workflows/ci.yml')).toContain('node scripts/audit/check-route-css-collisions.mjs')
    expect(read('package.json')).toContain('"audit:route-css"')
  })
})
