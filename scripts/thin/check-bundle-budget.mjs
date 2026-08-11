#!/usr/bin/env node
// Bundle budget gate (packet-02, first-paint proof) + purchase-exclusion proof.
// Run AFTER `vite build`: node scripts/thin/check-bundle-budget.mjs
//
// 1. Budget on RAW JS bytes (parse cost tracks uncompressed size). Re-based
//    2026-07-19 (Liam's call, packet-09): the scaffold-era ceiling (1.1 MB, set
//    at ~901 KB) predated the 6 converted screens; the full app builds at
//    ~1174 KB (gzip ~332 KB) — legitimate volume, not bloat. New ceiling =
//    current +~10% headroom; the tripwire is for accidental bloat (a stray
//    dependency), the real first-paint proof is the on-device p50 ≤ 300 ms
//    stop-rule. Code-splitting stays a post-ship option if device numbers
//    degrade.
// 2. Forbidden-content grep (Fable review round 1, codifying the manual A/B
//    proof): purchase-surface code must NEVER enter the bundle (§1.5). Component
//    identifiers minify away in prod, so each excluded file is ALSO tracked by a
//    distinctive string literal (translation key/namespace) that survives
//    minification. Any hit fails the gate.
//    Refined 2026-08-11 (Ruling B): the thin bundle now ships a real lazy
//    translation chunk (messages/en.json, boot-frozen locale). A few of the
//    tracked literals are ENGLISH PROSE COPY, not code identifiers or i18n
//    key namespaces — they can legitimately appear inside a translation blob
//    in any language ("Your last charge failed" is real billing copy that
//    belongs in en.json once translated, same as ja.json already carries the
//    Japanese equivalent). Scanning a translation-only chunk for prose would
//    fail the gate on the translation doing its job, not a leak. So the prose
//    markers are scoped OFF chunks whose build-manifest provenance is
//    exclusively messages/*.json; every identifier and dotted i18n-namespace
//    marker (code, never translation-JSON content) still scans EVERY chunk —
//    those catch the actual purchase-surface leak this gate exists for.
//    Provenance comes from the vite build manifest (thin/vite.config.ts sets
//    build.manifest: true), never a filename guess.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, dirname, basename } from 'node:path'

const DIST = 'thin/dist/assets'
const MANIFEST = 'thin/dist/.vite/manifest.json'
// 1.5 MB set-and-forget (Liam 7/19, after the auth integration landed at
// 1269.0 vs the 1_300_000 ceiling — 0.5 KB margin). Deliberately roomy: this
// number is only a bloat tripwire; the §1.5 purchase-marker scan below and the
// on-device first-paint stop-rule (packet-09) are the gates that matter and
// neither depends on it.
// Raised 2026-07-21 at packet 12 §B-3 S2 — the live 店舗 tab ships
// StoresSection + StoreFormDialog (+12.6 KB genuine section code,
// duplication-checked) against 6.2 KB of remaining headroom; still only a
// tripwire — the purchase-marker scan stays the real gate.
// Raised 2026-07-22 at packet 12 §B-3 S4b — the スタッフ tab goes live
// (StaffSection + StaffForm/PinSetup/VoiceEnrollmentDialog/
// InviteStaffDialog now ship), measured at 1584.7 KB raw against the prior
// 1562.5 KB ceiling. Still a NON-LOAD-BEARING size tripwire, not the real
// gate — the purchase-exclusion marker scan below (0/13) is what actually
// blocks a leak (Liam's 2026-07-19 ruling).
// Raised 2026-07-23 at packet 23 — /data-export goes live (DataExportView +
// its 9 section components, never bundled before today), measured at
// 1642.9 KB raw against the prior 1611.3 KB ceiling. Genuine new-screen
// volume (icons + column/filter metadata for a whole export config UI), not
// bloat — same class as every prior raise on this line.
// Raised 2026-07-27 at the booking-audit PR (#628) — 監査ログ viewer gains
// booking burn-outcome/changed-code sub-lines + the booking.* ja/en action
// labels, measured at 1670.5 KB raw against the prior 1669.9 KB ceiling
// (over by 0.6 KB). Genuine feature strings, not bloat — same class as
// every prior raise; the purchase-marker scan below stays the real gate.
// Raised 2026-07-29 at the 詳細記録-pencil PR (#644) — the summary edit
// sheet ships (SummaryEditSheet + card pencil wiring + facade port +
// summaryEdit/summary_edit ja/en strings), measured at 1679.9 KB raw
// against the prior 1679.7 KB ceiling (over by 0.2 KB). Genuine
// new-feature volume, not bloat — same class as every prior raise; the
// purchase-marker scan below stays the real gate.
// Raised 2026-08-02 at the presentation-mode PR (#669) — the customer-facing
// fullscreen photo presentation ships (PhotoPresentationOverlay + interlock
// wiring + present* ja/en strings), measured at 1690.8 KB raw against the
// prior 1689.5 KB ceiling (over by 1.3 KB). Genuine new-feature volume, not
// bloat — same class as every prior raise; the purchase-marker scan below
// stays the real gate. (A lazy-chunk split was tried first and REVERTED: the
// gate correctly counts total thin JS, so splitting only added overhead.)
// Raised 2026-08-09 (11th) at the full merge-queue convergence — the complete
// stack (#670, #686, #679/#680/#682 resolutions, #681, #683–#685, this branch)
// measures 1,753,807 B ground-truth (fresh deterministic build of the final
// tip, confirmed reproducible across two clean builds; the earlier ≈1748.6 KB
// figure projected the photo stack only — the six non-photo PRs' bytes were
// outside it). Next-round-thousand (1_754_000) would leave 193 B headroom —
// the 8/8 razor-fail (1692.4 > 1692.4) says never do that; ~1.3 KB is the floor.
// Raised 2026-08-10 (12th) at the revisit-outcome PR (PR-A) — the 結果 dialog
// gains the 4th 「既存のお客様（通常ご来店）」 card (amber tone entry, RotateCw
// icon, gate + guard sub-copy) and its ja/en strings, plus the fix round's
// read-shape degrade (unknown-outcome fallback chip) and selection guard —
// measured at 1,755,330 B ground-truth (deterministic: identical across two
// clean builds from an emptied thin/dist) against the prior 1_755_000 ceiling,
// over by 330 B. Genuine new-feature volume, not bloat; the purchase-marker
// scan below stays the real gate. Ceiling set 1,150 B above the measurement:
// deliberately NOT a round thousand (the 8/8 razor-fail was a 193 B margin;
// ~1 KB is the floor).
// Raised 2026-08-11 (13th) — thin forgot-password sub-view (login-screen
// request half; web confirm page finishes) — genuine new-feature volume, not
// bloat; measured 1,757,951.
// Raised 2026-08-11 (14th) at Ruling B — the en.json lazy locale chunk lands
// (boot-frozen EN/JP toggle on the app login screen), +115,977 B and the
// first non-ja content the thin bundle has ever shipped, measured
// 1,874,658 B ground-truth at ad219c50 against the prior 1_759_000 ceiling
// (over by 115,658 B). Genuine translation-chunk volume, not bloat — same
// class as every prior raise; the purchase-marker scan below (refined the
// same PR to exempt translation-only chunks from the prose markers) stays
// the real gate.
// Same-line conflict resolver keeps THIS number (largest wins; raises never
// shrink on a merge, only on a deliberate re-base measurement).
const BUDGET_BYTES = 1_875_000

let dir
try {
  dir = readdirSync(DIST)
} catch {
  console.error(`✗ no build output at ${DIST} — run \`vite build --config thin/vite.config.ts\` first`)
  process.exit(1)
}

const jsFiles = dir.filter((f) => f.endsWith('.js'))
let raw = 0
let gz = 0
for (const f of jsFiles) {
  const buf = readFileSync(join(DIST, f))
  raw += statSync(join(DIST, f)).size
  gz += gzipSync(buf).length
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
console.log(`thin JS: ${kb(raw)} raw / ${kb(gz)} gzip across ${jsFiles.length} chunk(s)`)
// Budget verdict is deferred to the end: exiting here used to skip the
// purchase-exclusion check entirely, so a budget breach masked a §1.5 leak.
const overBudget = raw > BUDGET_BYTES
if (overBudget) {
  console.error(`✗ over budget: ${kb(raw)} > ${kb(BUDGET_BYTES)} — code-split or trim before merge`)
} else {
  console.log(`✓ within budget (${kb(BUDGET_BYTES)})`)
}

// ── Chunk provenance (Ruling B) ──
// Which output files are composed SOLELY of messages/*.json source modules,
// per the vite build manifest — never a filename guess. A dynamically
// imported JSON module with no imports of its own (messages/en.json today)
// always becomes its own isolated chunk, so every manifest entry mapping to
// that output file has a messages/*.json `src`. If anything else is ever
// folded into that chunk, this drops to false and the file goes back to full
// scanning — the exemption only ever narrows, never widens, by accident.
if (!existsSync(MANIFEST)) {
  console.error(
    `✗ no build manifest at ${MANIFEST} — chunk provenance can't be proven. ` +
      'thin/vite.config.ts must build with `manifest: true` (no filename-pattern guessing here).',
  )
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const fileToSrcs = new Map()
for (const entry of Object.values(manifest)) {
  if (!entry.file) continue
  const srcs = fileToSrcs.get(entry.file) ?? []
  srcs.push(entry.src)
  fileToSrcs.set(entry.file, srcs)
}
const isMessagesSrc = (src) =>
  typeof src === 'string' && src.endsWith('.json') && basename(dirname(src)) === 'messages'
function isMessageOnlyChunk(file) {
  const srcs = fileToSrcs.get(`assets/${file}`)
  return !!srcs && srcs.length > 0 && srcs.every(isMessagesSrc)
}

// ── Purchase-exclusion proof (payments canon §1.5) ──
// Identifiers (pre-minification insurance) + one surviving string literal per
// excluded file. Keep in sync with PURCHASE_FILES in thin/vite.config.ts.
// Literal choice matters: bare t-keys ('staffUnlimited') exist as KEYS in the
// bundled messages/ja.json → guaranteed false positive. DOTTED useTranslations
// namespaces never appear in the nested JSON, only in component code — each one
// below is verified unique to its excluded file (StoresSection shares
// 'settings.stores.plan', so PlanComparisonDialog uses its unique className).
// These scan EVERY chunk, translation chunks included — none of them are
// prose, so none can legitimately appear as a messages/*.json value.
const FORBIDDEN_ALL_CHUNKS = [
  // identifiers
  'PlanComparisonGrid',
  'CancelConfirmDialog',
  'PaymentUpdateDialog',
  'AddStoreSubscriptionDialog',
  'PlanComparisonDialog',
  // minification-surviving literals, one per excluded file
  'settings.subscription.plans', // PlanComparisonGrid namespace
  'settings.subscription.cancel', // CancelConfirmDialog namespace
  'settings.subscription.paymentUpdate', // PaymentUpdateDialog namespace
  'settings.stores.addStoreSubscription', // AddStoreSubscriptionDialog namespace
  'max-h-[85vh] overflow-y-auto sm:max-w-5xl', // PlanComparisonDialog className
  // @synqed-kk/ui vendor copies (identifier = displayName literal, survives
  // minification; plus one copy literal each in case a package build drops it)
  'SubscriptionSummaryCard',
]
// Prose copy strings (Ruling B): real English sentences a translation JSON
// can legitimately carry once localized. Skipped on chunks whose sole
// manifest provenance is messages/*.json; scanned everywhere else.
const FORBIDDEN_PROSE = [
  "Your last charge failed", // subscription-summary-card DEFAULT_COPY
  'Downgrade to Free', // plan-comparison-grid DEFAULT_COPY (Greptile 4/5 backstop)
]
const TOTAL_MARKERS = FORBIDDEN_ALL_CHUNKS.length + FORBIDDEN_PROSE.length // 13, unchanged by Ruling B
const textFiles = dir.filter((f) => f.endsWith('.js') || f.endsWith('.css'))
const hits = []
for (const f of textFiles) {
  const text = readFileSync(join(DIST, f), 'utf8')
  const markers = isMessageOnlyChunk(f)
    ? FORBIDDEN_ALL_CHUNKS
    : [...FORBIDDEN_ALL_CHUNKS, ...FORBIDDEN_PROSE]
  for (const needle of markers) {
    if (text.includes(needle)) hits.push(`${f}: contains "${needle}"`)
  }
}
if (hits.length > 0) {
  console.error('✗ purchase-surface code leaked into the thin bundle (§1.5 payments canon):')
  for (const h of hits) console.error('  ' + h)
  process.exit(1)
}
console.log(`✓ purchase exclusion: 0/${TOTAL_MARKERS} forbidden markers across ${textFiles.length} asset(s)`)
if (overBudget) process.exit(1)
