#!/usr/bin/env node
/**
 * ⚖ Liam flag 69 (2026-08-22) — NO SELECTOR MAY BE DEFINED IN TWO ROUTE SHEETS.
 *
 * Next App Router emits each route segment's global CSS as its own stylesheet,
 * inserts it when that segment first renders, and does NOT remove it on client
 * navigation. Selectors at equal specificity therefore tie-break on DOCUMENT
 * ORDER, and document order is VISIT order — so after 今日の運営 → 予約 → back,
 * `reservations.css` sits after `today.css` and wins. That is how the board got
 * a phantom 390px second column: three sheets each defined `.biz .workspace`.
 *
 * The collision is invisible in review — every file reads perfectly on its own —
 * so it needs a machine. This is that machine. It globs EVERY route stylesheet
 * under (business) rather than naming them, so a room shipped tomorrow is
 * covered the day it lands.
 *
 * The shell sheet is excluded on purpose: it is the ONE shared home, and a route
 * sheet overriding it is the intended layering. Two ROUTE sheets defining the
 * same selector is the bug.
 *
 * Fix a failure by scoping BOTH sides to their own page class
 * (`.biz .page-today .workspace` / `.biz .page-reservations .workspace`).
 * Scoping only one side just flips which route breaks.
 *
 * The walker, the parser and the pure collision core are EXPORTED (same shape as
 * scripts/business/check-business-isolation.mjs) so the tripwire's own tests can
 * drive them on fixtures and prove the teeth are still there — a guard pinned
 * only by its source text would pass a regression that kept the strings and lost
 * the detection. The CLI below is the only thing that touches the real tree.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Every .css under `biz` except the shell sheet sitting at its root. */
export function routeSheets(biz, dir = biz, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) routeSheets(biz, full, out)
    else if (name.endsWith('.css') && dir !== biz) out.push(full)
  }
  return out
}

/** Selector heads of every rule, at any nesting depth. At-rules (@media,
 *  @supports) are transparent containers; at-rules that take no block of rules
 *  (@import, @charset) end at their semicolon and never reach here.
 *
 *  ⚠ @keyframes IS NOT A TRANSPARENT CONTAINER, and treating it as one made this
 *  guard cry wolf. Its children are keyframe SELECTORS (`0%`, `50%`, `from`,
 *  `to`) — namespaced by the animation's own name, so two sheets cannot collide
 *  through them however many of each they write. Walking into the block anyway
 *  turned every `0%` stop into a "selector", and the moment a second room shipped
 *  a breathe-style animation the gate failed on two sheets that share nothing but
 *  arithmetic (今日の運営's `wc-settle` meeting 録音's `rcBreathe`). A gate that
 *  fails for a reason that is not a defect gets muted, so the fix is here rather
 *  than a room renaming its stops. */
export function selectorsOf(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const found = new Set()
  let head = ''
  /** >0 while inside a @keyframes block: the depth of nesting still to close. */
  let framesDepth = 0
  for (const ch of clean) {
    if (ch === '{') {
      const text = head.trim()
      head = ''
      if (framesDepth > 0) { framesDepth += 1; continue }
      if (/^@(?:-[a-z]+-)?keyframes\b/i.test(text)) { framesDepth = 1; continue }
      if (!text || text.startsWith('@')) continue
      for (const sel of text.split(',')) {
        const one = sel.replace(/\s+/g, ' ').trim()
        if (one) found.add(one)
      }
    } else if (ch === '}') {
      head = ''
      if (framesDepth > 0) framesDepth -= 1
    } else if (ch === ';') {
      head = ''
    } else {
      head += ch
    }
  }
  return found
}

/** Pure core. sheets = [{ path, css }] — ROUTE sheets only, the shell already
 *  dropped by routeSheets. Returns [selector, paths[]] for every selector
 *  defined in more than one of them, sorted. */
export function findCollisions(sheets) {
  const owners = new Map()
  for (const { path, css } of sheets) {
    for (const sel of selectorsOf(css)) {
      if (!owners.has(sel)) owners.set(sel, [])
      owners.get(sel).push(path)
    }
  }
  return [...owners.entries()].filter(([, files]) => files.length > 1).sort()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ROOT = process.cwd()
  const sheets = routeSheets(join(ROOT, 'src/app/[locale]/(business)')).sort()
  const clashes = findCollisions(
    sheets.map((file) => ({ path: relative(ROOT, file), css: readFileSync(file, 'utf8') })),
  )

  if (clashes.length === 0) {
    console.log(`route CSS collisions: none across ${sheets.length} route stylesheet(s).`)
    process.exit(0)
  }

  console.error(`route CSS collisions: ${clashes.length} selector(s) defined in more than one route stylesheet.\n`)
  for (const [sel, files] of clashes) console.error(`  ${sel}\n      ${files.join('\n      ')}`)
  console.error('\nScope BOTH sides to their own page class — see this file\'s header.')
  process.exit(1)
}
