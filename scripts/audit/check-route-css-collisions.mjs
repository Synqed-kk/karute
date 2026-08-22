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
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const BIZ = join(ROOT, 'src/app/[locale]/(business)')

/** Every .css under (business) except the shell sheet sitting at its root. */
function routeSheets(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) routeSheets(full, out)
    else if (name.endsWith('.css') && dir !== BIZ) out.push(full)
  }
  return out
}

/** Selector heads of every rule, at any nesting depth. At-rules (@media,
 *  @supports) are transparent containers; at-rules that take no block of rules
 *  (@import, @charset) end at their semicolon and never reach here. */
function selectorsOf(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const found = new Set()
  let head = ''
  for (const ch of clean) {
    if (ch === '{') {
      const text = head.trim()
      head = ''
      if (!text || text.startsWith('@')) continue
      for (const sel of text.split(',')) {
        const one = sel.replace(/\s+/g, ' ').trim()
        if (one) found.add(one)
      }
    } else if (ch === '}' || ch === ';') {
      head = ''
    } else {
      head += ch
    }
  }
  return found
}

const sheets = routeSheets(BIZ).sort()
const owners = new Map()
for (const file of sheets) {
  for (const sel of selectorsOf(readFileSync(file, 'utf8'))) {
    if (!owners.has(sel)) owners.set(sel, [])
    owners.get(sel).push(relative(ROOT, file))
  }
}

const clashes = [...owners.entries()].filter(([, files]) => files.length > 1).sort()
if (clashes.length === 0) {
  console.log(`route CSS collisions: none across ${sheets.length} route stylesheet(s).`)
  process.exit(0)
}

console.error(`route CSS collisions: ${clashes.length} selector(s) defined in more than one route stylesheet.\n`)
for (const [sel, files] of clashes) console.error(`  ${sel}\n      ${files.join('\n      ')}`)
console.error('\nScope BOTH sides to their own page class — see this file\'s header.')
process.exit(1)
