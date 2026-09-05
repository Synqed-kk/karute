#!/usr/bin/env node
// In-tier regression pins for the audio-never-deleted guard (same pattern as
// scripts/business/check-business-data-access.selftest.mjs). The live run scans
// a repo that holds exactly ONE delete — the voice exemption — so it exercises
// almost none of the rules. These fixtures are the red→green proof that the
// guard catches every shape a re-added delete could arrive in, including the
// HIDDEN ones a line-level regex would walk straight past.

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanAudioDeletes } from './check-audio-never-deleted.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const root = mkdtempSync(join(tmpdir(), 'audiodel-'))

const write = (rel, src) => {
  mkdirSync(join(root, dirname(rel)), { recursive: true })
  writeFileSync(join(root, rel), src)
}
const clear = (rel) => rmSync(join(root, rel), { recursive: true, force: true })

// 1. RED — the plain shape: the worker's old success delete, back again.
write(
  'src/lib/jobs/process-recording.ts',
  `export async function processJob(payload) {
  const supabase = createServiceClient()
  await supabase.storage.from('recordings').remove([payload.audio_path])
}
`,
)
const plain = scanAudioDeletes(root)
assert.equal(plain.length, 1, `expected the direct delete flagged, got ${JSON.stringify(plain)}`)
assert.equal(plain[0].symbol, 'processJob')
assert.match(plain[0].label, /deletes an object/)
clear('src/lib')

// 2. RED — THE HIDDEN ONE. The chain is split across statements, so the bucket
//    name and the `.remove(` never share a line: a text scan sees nothing.
write(
  'src/actions/janitor.ts',
  `const supabase = createServiceClient()
const bucket = supabase
  .storage
  .from('recordings')

export async function sweep(key) {
  await bucket.remove([key])
}
`,
)
const hidden = scanAudioDeletes(root)
assert.equal(hidden.length, 1, `the aliased bucket must still be caught, got ${JSON.stringify(hidden)}`)
assert.equal(hidden[0].symbol, 'sweep')
clear('src/actions')

// 3. RED — the bucket name lives in a constant, so the literal 'recordings'
//    appears nowhere in the chain. Going through `.storage` is enough.
write(
  'src/lib/x.ts',
  `const BUCKET = 'recordings'
export async function drop(c, key) {
  await c.storage.from(BUCKET).remove([key])
}
`,
)
assert.equal(scanAudioDeletes(root).length, 1)
clear('src/lib')

// 4. RED — thin/ is scanned too: the phone bundle is not a blind spot.
write('thin/ports/x.ts', `export const p = { async wipe(c, k) { await c.storage.from('recordings').remove([k]) } }\n`)
assert.equal(scanAudioDeletes(root).length, 1, 'thin/ must be scanned')
clear('thin')

// 5. GREEN — the neighbours a naive `.remove(` scan false-flags. None of them
//    touches storage.
write(
  'src/components/X.tsx',
  `export function X(el, store, node) {
  el.classList.remove('is-open')
  store.remove('key')
  node.remove()
}
`,
)
assert.deepEqual(scanAudioDeletes(root), [])
clear('src/components')

// 6. GREEN — prose naming the delete is not a call (the AST makes this free;
//    pinned so a future text-based rewrite cannot regress it).
write(
  'src/lib/notes.ts',
  `// we used to call supabase.storage.from('recordings').remove([path]) here
/* supabase.storage.from('recordings').remove([path]) */
export const s = "supabase.storage.from('recordings').remove([path])"
`,
)
assert.deepEqual(scanAudioDeletes(root), [])
clear('src/lib')

// 7. GREEN — the ONE exemption, fenced: staff own their own voice.
const FENCED = `export async function revokeVoiceActionCore(synqed, businessId, deps, staffId) {
  const ownPrefix = \`voice-enroll/\${businessId}/\${staffId}\`
  const paths = [current.sample_path].filter((p) => typeof p === 'string' && p.startsWith(ownPrefix))
  const supabase = createServiceClient()
  await supabase.storage.from('recordings').remove(paths)
}
`
write('src/actions/voice.ts', FENCED)
assert.deepEqual(scanAudioDeletes(root), [], 'the fenced voice exemption is green')

// 8. RED — the same call with the runtime fence REMOVED. The exemption is the
//    fence, not the file name: an unfenced remove in voice.ts deletes any key
//    the settings blob happens to carry.
write(
  'src/actions/voice.ts',
  `export async function revokeVoiceActionCore(synqed, businessId, deps, staffId) {
  const paths = [current.sample_path].filter((p) => !!p)
  const supabase = createServiceClient()
  await supabase.storage.from('recordings').remove(paths)
}
`,
)
const unfenced = scanAudioDeletes(root)
assert.equal(unfenced.length, 1, 'an unfenced voice delete must be flagged')
assert.match(unfenced[0].label, /lost its runtime fence/)

// 9. RED — the exemption does not travel: the same fenced code in a DIFFERENT
//    symbol of the same file is not the exempt call site.
write('src/actions/voice.ts', FENCED.replace('revokeVoiceActionCore', 'wipeEverything'))
const wrongSymbol = scanAudioDeletes(root)
assert.equal(wrongSymbol.length, 1, 'only the named symbol is exempt')
assert.match(wrongSymbol[0].label, /deletes an object/)

// 10. RED — THE ONE THAT ESCAPED. The fence is read out of the exempt
//     FUNCTION's text, never the file's: the real voice.ts carries
//     `voice-enroll/` in its enrolment writer and `startsWith('audio/')` in a
//     MIME check, so a file-wide scan stayed GREEN with the revoke fence
//     deleted. Found by running the mutation proof on the guard itself
//     (2026-09-04); this fixture reproduces exactly that file shape.
write(
  'src/actions/voice.ts',
  `export async function enrollVoiceActionCore(businessId, staffId, audio) {
  if (audio.type && !audio.type.startsWith('audio/')) return { ok: false }
  return { samplePath: \`voice-enroll/\${businessId}/\${staffId}.webm\` }
}

export async function revokeVoiceActionCore(synqed, businessId, deps, staffId) {
  const paths = [current.sample_path].filter((p) => !!p)
  const supabase = createServiceClient()
  await supabase.storage.from('recordings').remove(paths)
}
`,
)
const decoyFence = scanAudioDeletes(root)
assert.equal(decoyFence.length, 1, 'a fence elsewhere in the file must not exempt the revoke')
assert.match(decoyFence[0].label, /lost its runtime fence/)
clear('src/actions')

// 11. RED — THE COMMENT-ONLY FENCE. The fence is deleted and DESCRIBED, and
//     the old check read the symbol's raw text, so prose about a filter passed
//     for the filter (mutation-proven, fix round 1). The fence is read out of
//     the symbol's code now; a comment contributes nothing.
write(
  'src/actions/voice.ts',
  `export async function revokeVoiceActionCore(synqed, businessId, deps, staffId) {
  // Keys are filtered against the voice-enroll/ prefix with startsWith, so a
  // settings blob carrying a recording key can never reach the remove below.
  const paths = [current.sample_path].filter((p) => !!p)
  const supabase = createServiceClient()
  await supabase.storage.from('recordings').remove(paths)
}
`,
)
const proseFence = scanAudioDeletes(root)
assert.equal(proseFence.length, 1, 'a fence that is only described must not exempt the delete')
assert.match(proseFence[0].label, /lost its runtime fence/)
clear('src/actions')

// 12. RED — `['remove']`. The same call, spelled so that no scan looking for
//     the property name `remove` can see it.
write(
  'src/lib/bracket.ts',
  `export async function bracketDrop(c, key) {
  await c.storage.from('recordings')['remove']([key])
}
`,
)
const bracket = scanAudioDeletes(root)
assert.equal(bracket.length, 1, `element-access remove must be caught, got ${JSON.stringify(bracket)}`)
assert.equal(bracket[0].symbol, 'bracketDrop')
clear('src/lib')

// 13. RED — the delete function LIFTED OFF the handle. By the time it is
//     called there is no chain left to walk, under its own name or a rename.
write(
  'src/lib/lifted.ts',
  `const { remove } = supabase.storage.from('recordings')
export async function lifted(key) {
  await remove([key])
}
`,
)
const lifted = scanAudioDeletes(root)
assert.equal(lifted.length, 1, `a destructured remove must be caught, got ${JSON.stringify(lifted)}`)
assert.equal(lifted[0].symbol, 'lifted')
write(
  'src/lib/lifted.ts',
  `const { remove: drop } = supabase.storage.from('recordings')
export async function renamed(key) {
  await drop([key])
}
`,
)
assert.equal(scanAudioDeletes(root)[0]?.symbol, 'renamed', 'the rename is the same delete')
clear('src/lib')

// 14. GREEN — ANOTHER BUCKET. This rule is about recordings; a photos delete
//     reported at its own file and line as a recording delete is a false
//     accusation, and a guard that makes them gets ignored.
write(
  'src/lib/photos.ts',
  `const PHOTO_BUCKET = 'photos'
export async function dropPhoto(c, key, k2) {
  await c.storage.from('photos').remove([key])
  await c.storage.from(PHOTO_BUCKET).remove([k2])
}
`,
)
assert.deepEqual(scanAudioDeletes(root), [], 'a photos delete is not this rule')
clear('src/lib')

// 15. RED — but a bucket this file cannot resolve still fails closed: "I could
//     not tell" is not a reason to allow a delete here.
write(
  'src/lib/unknown-bucket.ts',
  `export async function dropAny(c, bucket, key) {
  await c.storage.from(bucket).remove([key])
}
`,
)
assert.equal(scanAudioDeletes(root).length, 1, 'an unresolvable bucket stays flagged')
clear('src/lib')

// 16. GREEN — BUILD OUTPUT is not source. thin/dist carries the bundled app
//     (every delete in it is a copy of one in src/, and parsing it costs
//     minutes). The real run gets this from git — the directory is ignored —
//     and this fixture pins the walk's fallback skip list.
write('thin/dist/assets/index-abc123.js', `async function x(c,k){await c.storage.from('recordings').remove([k])}\n`)
assert.deepEqual(scanAudioDeletes(root), [], 'build output is not scanned')
write('thin/ports/real.ts', `export async function realDrop(c, k) { await c.storage.from('recordings').remove([k]) }\n`)
assert.equal(scanAudioDeletes(root).length, 1, 'the same code in a SOURCE path is still caught')
clear('thin')

// 17. RED — THE PROPERTY LIFT (fix round 4, F4). The same delete function,
//     taken off the handle by NAMING it rather than destructuring it. Until
//     round 4 this registered the local name as a bucket ALIAS, so the bare
//     call that followed had no chain, no alias hit and no destructured
//     binding — the scan reported ZERO findings for a working delete.
write(
  'src/lib/lifted-prop.ts',
  `const del = supabase.storage.from('recordings').remove
export async function propLift(key) {
  await del([key])
}
`,
)
const propLift = scanAudioDeletes(root)
assert.equal(propLift.length, 1, `a property-lifted remove must be caught, got ${JSON.stringify(propLift)}`)
assert.equal(propLift[0].symbol, 'propLift')
// …and the alias it is NOT: a handle bound the same way still resolves its
// own `.remove(` through the chain, at the call site, under its own symbol.
write(
  'src/lib/lifted-prop.ts',
  `const handle = supabase.storage.from('recordings')
export async function stillAliased(key) {
  await handle.remove([key])
}
`,
)
assert.equal(
  scanAudioDeletes(root)[0]?.symbol,
  'stillAliased',
  'binding the HANDLE is still an alias, not a lifted delete',
)
clear('src/lib')

// 18. RED — EMPTY THE BUCKET. The broadest delete there is, and it names no
//     key at all, so every rule keyed on `remove` walked past it. Same
//     treatment as `remove` everywhere: the call, the destructure, the lift.
write(
  'src/lib/empty.ts',
  `export async function nuke(c) {
  await c.storage.emptyBucket('recordings')
}
`,
)
const emptied = scanAudioDeletes(root)
assert.equal(emptied.length, 1, `emptyBucket must be caught, got ${JSON.stringify(emptied)}`)
assert.equal(emptied[0].symbol, 'nuke')
// The file names no `remove` anywhere — the cheap pre-filter must not skip it.
assert.ok(!readFileSync(join(root, 'src/lib/empty.ts'), 'utf8').includes('remove'))
// …and lifted off the handle it is the same delete under a local name.
write(
  'src/lib/empty.ts',
  `const { emptyBucket: wipe } = supabase.storage.from('recordings')
export async function nukeLifted() {
  await wipe()
}
`,
)
assert.equal(scanAudioDeletes(root)[0]?.symbol, 'nukeLifted', 'a lifted emptyBucket is the same delete')
// GREEN — and it is still bucket-scoped: emptying `photos` is not this rule.
write(
  'src/lib/empty.ts',
  `export async function nukePhotos(c) {
  await c.storage.from('photos').emptyBucket()
}
`,
)
assert.deepEqual(scanAudioDeletes(root), [], 'emptying another bucket is not this rule')
clear('src/lib')

// 19. The REAL repo is green — one exempt, fenced delete and nothing else.
rmSync(root, { recursive: true, force: true })
assert.deepEqual(scanAudioDeletes(repo), [])

console.log('✓ audio-never-deleted guard selftest: 19 cases green')
