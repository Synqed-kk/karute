#!/usr/bin/env node
// Selftest for the parity harness's scoped-class extractor (scoped-classes.mjs) — fixture red, in seconds.
//   node scripts/business/reserve-card-parity/scoped-classes.selftest.mjs
// Each case calls scopedClasses(<block texts>) and asserts the exact class list. Pure: nothing is read or written.
import { countWord, scopedClasses } from './scoped-classes.mjs'

const CASES = [
  ['rule + :active + @media list → one class', ['/* press */\n.pressable {\n  transition: none;\n}\n.pressable:active { transform: scale(0.975); }\n@media (prefers-reduced-motion: reduce) {\n  .pressable, .pressable:active { transition: none; }\n}'], ['.pressable']],
  ['::before pseudo-element dropped', ['.tap44 { position: relative; }\n.tap44::before {\n  content: "";\n}'], ['.tap44']],
  ['two blocks: order kept, dupes dropped', ['.b { a: 1; }\n.a:hover { a: 1; }', '.a { a: 1; }\n.c { a: 1; }\n.b::after { a: 1; }'], ['.b', '.a', '.c']],
  ['no class selector → []', ['body { margin: 0; }\n@media (min-width: 1px) {\n  :root { --x: 1; }\n}'], []],
  ['top-level comma split, not inside :is()', [':is(.x, .y) .z, .w { a: 1; }'], ['.w']],
]

let failed = 0
for (const [name, blocks, want] of CASES) {
  const got = scopedClasses(blocks)
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — got ${JSON.stringify(got)}`}`)
}
const words = [[1, 'one'], [3, 'three'], [9, 'nine'], [10, '10'], [0, '0']]
for (const [n, w] of words) {
  const ok = countWord(n) === w
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} countWord(${n}) → ${w}${ok ? '' : ` — got ${countWord(n)}`}`)
}
const total = CASES.length + words.length
if (failed) {
  console.error(`✗ parity scoped-classes selftest: ${failed} of ${total} cases red`)
  process.exit(1)
}
console.log(`✓ parity scoped-classes selftest: ${total} cases green`)
