#!/usr/bin/env node
// R13 recurrence guard (Liam's law, 2026-08-06): no interactive element —
// tab, button, chip, toggle, segmented control — is EVER deliberately black.
// Dark fills are legal only on non-interactive surfaces (photo canvases,
// scrims, decorative marks) — every one of those must be allowlisted here
// WITH a reason. The interactive accent lives in --primary / the karute
// --color-accent override in src/app/globals.css (blue-600 #2563eb).
//
// Run: npm run audit:dark-interactive   (wired into CI's audit gates)
//
// What it catches (src/ + thin/, .tsx AND .ts — class-string constants in
// .ts files feed className props, so they're in scope):
//   - bg-foreground as a SOLID fill (ink-as-fill; washes like /10 are fine)
//   - bg-sage-600..950 (the sage 600+ steps are all near-black hexes)
//   - solid bg-black, INCLUDING dark:bg-black (a black fill has no
//     legitimate dark-mode reading either; the dark: exemption below is for
//     the neutral-800/900 family only, which IS the dark-mode surface set)
//   - light-mode bg-{zinc,neutral,gray,stone,slate}-800/900/950
//   - arbitrary-value fills: bg-[#near-black-hex], bg-[black],
//     bg-[rgb(low,low,low)], bg-[oklch(0.0–0.29 …)]
//   - inline style background: near-black hex, 'black', or low rgb()
//
// Documented ceilings (accepted, not bugs):
//   - Dynamically composed class names (`bg-${shade}`) are invisible to a
//     text scan — Tailwind's own JIT extractor shares the blind spot, so the
//     utility usually can't even be generated unless the full literal exists
//     somewhere this scan reads.
//   - "Near-black" = every RGB channel's high nibble ≤ 3 (≤ #3f3f3f). A
//     #404040 gray passes; tightening trades false positives.
//   - ROOTS is a fixed list; a brand-new top-level UI directory would need
//     adding here. (Checked 2026-08-06: no .tsx/.jsx exists outside src/+thin/.)

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['src', 'thin']
const rootDir = process.cwd()

// Solid dark fill classes. `(?!\/)` keeps opacity washes (bg-foreground/10,
// bg-black/40) legal — a wash is a tint, not a black box.
const NEARBLACK_HEX = '#(?:[0-3][0-9a-fA-F][0-3][0-9a-fA-F][0-3][0-9a-fA-F]\\b|[0-3][0-3][0-3]\\b)'
const LOW_CHANNEL = '(?:[0-5]?\\d|6[0-3])' // 0–63 of 255
// (?!\s*,\s*0?\.) — rgba with alpha < 1 is a scrim/wash, same legality as
// bg-black/40; only opaque low-rgb fills count.
const LOW_RGB = `rgba?\\(\\s*${LOW_CHANNEL}\\s*,\\s*${LOW_CHANNEL}\\s*,\\s*${LOW_CHANNEL}(?!\\s*,\\s*0?\\.)`
const CLASS_PATTERNS = [
  { re: /(?<!dark:)bg-foreground(?!\/)/g, label: 'bg-foreground solid fill (ink as fill)' },
  { re: /bg-sage-(?:[6-9]\d\d)/g, label: 'bg-sage-600+ (near-black sage step)' },
  { re: /bg-black(?![/\w-])/g, label: 'solid bg-black (any mode)' },
  { re: /(?<!dark:)bg-(?:zinc|neutral|gray|stone|slate)-(?:8|9)\d\d(?!\/)/g, label: 'light-mode dark neutral fill' },
  {
    re: new RegExp(`bg-\\[(?:${NEARBLACK_HEX}|black\\]|${LOW_RGB}|oklch\\(\\s*0?\\.[0-2])`, 'g'),
    label: 'arbitrary-value near-black fill',
  },
]
// Inline styles: background/backgroundColor with a near-black hex, the
// keyword 'black', or an all-low rgb()/rgba().
const INLINE_RE = new RegExp(
  `background(?:Color)?:\\s*['"](?:${NEARBLACK_HEX}|black\\b|${LOW_RGB})`,
  'g',
)

// Known-legal dark fills. Each exemption is scoped to the EXACT documented
// occurrence: path + label + a `match` substring the flagged line must
// contain, AND a `count` budget — if the pinned substring starts appearing
// on MORE lines than documented (e.g. copy-pasted onto a new interactive
// element, the guard-attack round's sharpest hole), the whole entry fails
// closed and every matching line is reported.
const ALLOW = [
  {
    path: 'src/components/staff/PinPad.tsx',
    label: 'bg-foreground solid fill (ink as fill)',
    match: ["'bg-foreground border-foreground'"],
    count: 1,
    reason: 'passcode-entry dots — non-interactive filled/unfilled indicators (iOS PIN pattern)',
  },
  {
    path: 'src/components/profile/redesign/ProfilePageView.tsx',
    label: 'bg-foreground solid fill (ink as fill)',
    match: ['rounded-full bg-foreground text-base font-semibold'],
    count: 1,
    reason: 'avatar-initials circle — non-interactive identity mark',
  },
  {
    path: 'src/components/layout/sidebar.tsx',
    label: 'light-mode dark neutral fill',
    match: ["'dark bg-neutral-900'"],
    count: 1,
    reason: 'the "dark" sidebar appearance setting — a themed surface, not a control fill',
  },
  {
    path: 'src/components/settings/redesign/sections/ThemeSection.tsx',
    label: 'light-mode dark neutral fill',
    match: [
      'h-1.5 w-10 rounded-sm bg-gray-900',
      'h-1.5 w-12 rounded-sm bg-gray-800',
      'w-14 space-y-1 bg-gray-900 p-1.5',
    ],
    count: 4,
    reason: 'theme-preview thumbnails — miniature non-interactive illustrations of the dark theme',
  },
]

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name))
      out.push(p)
  }
}

const files = []
for (const r of ROOTS) walk(join(rootDir, r), files)

const findings = []
const exemptUses = new Map() // ALLOW entry -> [{line, text}]
for (const file of files) {
  const rel = relative(rootDir, file)
  if (rel.includes('__tests__')) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  let inBlockComment = false
  lines.forEach((line, i) => {
    // Comment handling (guard-attack round findings 7/8): strip inline
    // /* … */ and JSX {/* … */} spans, whole-line // comments, and lines
    // inside a multi-line block comment — comment PROSE mentioning a
    // forbidden class must not flag, and code after a comment must still scan.
    let code = line
    if (inBlockComment) {
      const end = code.indexOf('*/')
      if (end === -1) return
      code = code.slice(end + 2)
      inBlockComment = false
    }
    code = code.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
    const open = code.indexOf('/*')
    if (open !== -1) {
      code = code.slice(0, open)
      inBlockComment = true
    }
    code = code.replace(/^\s*\/\/.*$/, '').replace(/^\s*\*.*$/, '')

    for (const { re, label } of CLASS_PATTERNS) {
      re.lastIndex = 0
      if (!re.test(code)) continue
      const entry = ALLOW.find(
        (a) => a.path === rel && a.label === label && a.match.some((m) => line.includes(m)),
      )
      if (entry) {
        // Exempt only as many OCCURRENCES as the pinned substrings themselves
        // carry (Greptile r4 #671): a second same-pattern fill added beside
        // the pin on the same line must not ride the exemption.
        re.lastIndex = 0
        const lineHits = [...code.matchAll(re)].length
        const pinHits = entry.match
          .filter((m) => line.includes(m))
          .reduce((n, m) => {
            re.lastIndex = 0
            return n + [...m.matchAll(re)].length
          }, 0)
        if (lineHits > pinHits) {
          findings.push({
            rel,
            line: i + 1,
            label: `${label} — ${lineHits} occurrences exceed the ${pinHits} pinned on this line`,
            text: line.trim().slice(0, 120),
          })
          continue
        }
        if (!exemptUses.has(entry)) exemptUses.set(entry, [])
        exemptUses.get(entry).push({ line: i + 1, text: line.trim().slice(0, 120) })
        continue
      }
      findings.push({ rel, line: i + 1, label, text: line.trim().slice(0, 120) })
    }
    INLINE_RE.lastIndex = 0
    if (INLINE_RE.test(code)) {
      findings.push({ rel, line: i + 1, label: 'inline near-black background', text: line.trim().slice(0, 120) })
    }
  })
}

// Count budgets: a pinned substring appearing on more lines than documented
// means it was copied onto something new — fail closed on the whole entry.
for (const [entry, uses] of exemptUses) {
  if (uses.length > entry.count) {
    for (const u of uses) {
      findings.push({
        rel: entry.path,
        line: u.line,
        label: `allowlist over budget (${uses.length} > ${entry.count} pinned)`,
        text: u.text,
      })
    }
  }
}

if (findings.length) {
  console.error(`✗ dark interactive fill guard: ${findings.length} violation(s)\n`)
  for (const f of findings) {
    console.error(`  ${f.rel}:${f.line}  [${f.label}]\n    ${f.text}`)
  }
  console.error(
    '\nR13: selected state = bg-primary/8 text-primary (+ border-primary);' +
      '\ncommit action = bg-primary text-primary-foreground hover:bg-primary-hover.' +
      '\nNever a black fill. Genuinely non-interactive dark surface? Add an ALLOW' +
      '\nentry with a reason and an exact-occurrence pin + count.',
  )
  process.exit(1)
}
console.log(`✓ dark interactive fill guard: ${files.length} files clean`)
