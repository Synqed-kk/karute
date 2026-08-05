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
// What it catches (class-level, src/ + thin/ .tsx):
//   - bg-foreground as a SOLID fill (ink-as-fill; washes like /10 are fine)
//   - bg-sage-600..950 (the sage 600+ steps are all near-black hexes)
//   - solid bg-black (scrims bg-black/40 are fine)
//   - light-mode bg-{zinc,neutral,gray,stone,slate}-800/900/950
//   - inline style background with a near-black hex
//   - dark hover fills (hover:bg-<dark>) — the "flashes black on hover" family

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['src', 'thin']
const rootDir = process.cwd()

// Solid dark fill classes. `(?!\/)` keeps opacity washes (bg-foreground/10,
// bg-black/40) legal — a wash is a tint, not a black box.
const CLASS_PATTERNS = [
  { re: /(?<!dark:)bg-foreground(?!\/)/g, label: 'bg-foreground solid fill (ink as fill)' },
  { re: /bg-sage-(?:[6-9]\d\d)/g, label: 'bg-sage-600+ (near-black sage step)' },
  { re: /(?<!dark:)bg-black(?![/\w-])/g, label: 'solid bg-black' },
  { re: /(?<!dark:)bg-(?:zinc|neutral|gray|stone|slate)-(?:8|9)\d\d(?!\/)/g, label: 'light-mode dark neutral fill' },
]
// Inline styles: background/backgroundColor with a near-black hex — every
// RGB channel's high nibble ≤ 3 (#0f172a, #18181b yes; #2563eb no: green 6).
const INLINE_RE =
  /background(?:Color)?:\s*['"]#(?:[0-3][0-3][0-3]\b|[0-3][0-9a-fA-F][0-3][0-9a-fA-F][0-3][0-9a-fA-F])/g

// Known-legal dark fills. Path + which label it excuses + why it's legal.
const ALLOW = [
  { path: 'src/components/staff/PinPad.tsx', label: 'bg-foreground solid fill (ink as fill)', reason: 'passcode-entry dots — non-interactive filled/unfilled indicators (iOS PIN pattern)' },
  { path: 'src/components/profile/redesign/ProfilePageView.tsx', label: 'bg-foreground solid fill (ink as fill)', reason: 'avatar-initials circle — non-interactive identity mark' },
  { path: 'src/components/customers/redesign/profile/PhotoCompareView.tsx', label: 'solid bg-black', reason: 'photo canvas — media surface behind photos' },
  { path: 'src/components/customers/redesign/profile/PhotoPresentationOverlay.tsx', label: 'solid bg-black', reason: 'customer-facing fullscreen photo canvas' },
  { path: 'src/components/layout/sidebar.tsx', label: 'light-mode dark neutral fill', reason: 'the "dark" sidebar appearance setting — a themed surface, not a control fill' },
  { path: 'src/components/settings/redesign/sections/ThemeSection.tsx', label: 'light-mode dark neutral fill', reason: 'theme-preview thumbnails — miniature non-interactive illustrations of the dark theme' },
]

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(p)
  }
}

const files = []
for (const r of ROOTS) walk(join(rootDir, r), files)

const findings = []
for (const file of files) {
  const rel = relative(rootDir, file)
  if (rel.includes('__tests__')) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '') // skip pure comment lines
    for (const { re, label } of CLASS_PATTERNS) {
      re.lastIndex = 0
      if (!re.test(code)) continue
      if (ALLOW.some((a) => a.path === rel && a.label === label)) continue
      findings.push({ rel, line: i + 1, label, text: line.trim().slice(0, 120) })
    }
    INLINE_RE.lastIndex = 0
    if (INLINE_RE.test(code)) {
      findings.push({ rel, line: i + 1, label: 'inline near-black background', text: line.trim().slice(0, 120) })
    }
  })
}

if (findings.length) {
  console.error(`✗ dark interactive fill guard: ${findings.length} violation(s)\n`)
  for (const f of findings) {
    console.error(`  ${f.rel}:${f.line}  [${f.label}]\n    ${f.text}`)
  }
  console.error(
    '\nR13: selected state = bg-primary/10 text-primary (+ border-primary);' +
      '\ncommit action = bg-primary text-primary-foreground. Never a black fill.' +
      '\nGenuinely non-interactive dark surface? Add an ALLOW entry with a reason.',
  )
  process.exit(1)
}
console.log(`✓ dark interactive fill guard: ${files.length} files clean`)
