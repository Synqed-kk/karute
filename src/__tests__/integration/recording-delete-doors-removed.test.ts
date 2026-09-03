/**
 * ⚖ THE DELETE DOORS ARE GONE — a census, not a behaviour test (capture
 * pipeline PR4, design v2 item 10).
 *
 * Every suite beside this one proves what the code DOES. This one proves what
 * it no longer CONTAINS, because the failure mode being guarded is not a wrong
 * answer — it is a delete quietly coming back, refusing on some flag instead of
 * being absent, or moving to a neighbouring file under a new name. A behaviour
 * assertion cannot tell "refused today" from "cannot happen"; reading the
 * source can.
 *
 * The runtime guard is scripts/audit/check-audio-never-deleted.mjs (with its
 * selftest), wired into CI's audit-gates job. This suite is its jest-tier twin
 * and pins the SIX named doors by file and shape, so a reviewer reading the PR
 * can see the list and a future edit that restores one fails here first.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

/** Source with comment lines dropped — every one of these files EXPLAINS the
 *  door it lost, and prose naming a delete is not a delete. */
const code = (rel: string) =>
  read(rel)
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')

describe('the six doors that could delete a recording', () => {
  it('1. the worker no longer removes the object it just transcribed', () => {
    const src = code('src/lib/jobs/process-recording.ts')
    expect(src).not.toContain('.remove(')
    // …and it still READS it: the leg that survives is the signed read url.
    expect(src).toContain('createSignedUrl')
  })

  it('2. the facade transcribe route has no finally-delete', () => {
    const src = code('src/app/api/app/v1/ai/transcribe/route.ts')
    expect(src).not.toContain('.remove(')
    expect(src).toContain('createSignedUrl')
  })

  it('3. the web port has no cleanup leg — and no stageForJob to feed one', () => {
    const src = code('src/lib/ports/recording-port.ts')
    expect(src).not.toContain('removeRecordingObject')
    expect(src).not.toContain('cleanup')
    expect(src).not.toContain('stageForJob')
  })

  it('4. the staged-audio janitor module is DELETED, not emptied', () => {
    expect(existsSync(join(process.cwd(), 'src/lib/recording/staged-audio.ts'))).toBe(false)
    // …and neither of its two callers still reaches for it.
    for (const rel of [
      'src/actions/recording-discard-transcript.ts',
      'src/app/api/app/v1/recordings/discards/transcript/route.ts',
    ]) {
      expect(code(rel)).not.toContain('sweepStagedDiscardAudio')
      expect(code(rel)).not.toContain('.remove(')
    }
  })

  it('5. the discard-transcript client marks the take done instead of deleting it', () => {
    const src = code('src/lib/recording/discard-transcript.ts')
    expect(src).not.toContain('deleteTake')
    expect(src).toContain('markDiscardTranscriptDone')
  })

  it('6. removeRecordingObject — the client-invokable delete action — is gone', () => {
    expect(code('src/actions/recording-upload.ts')).not.toContain('removeRecordingObject')
  })

  it('and the phone port lost its staging door too', () => {
    expect(code('thin/ports/recording.vite.ts')).not.toContain('stageForJob')
  })
})

describe('what REPLACED them', () => {
  it('deleteTake carries the one guard: no finalizedAt, no delete', () => {
    const src = code('src/lib/karute/take-store.ts')
    expect(src).toContain("if (meta && !meta.finalizedAt && !opts?.humanResolved) return")
  })

  // ⚖ ONE EXIT, AND IT IS A PERSON (fix round 1). The guard needs a way out or
  // a 確認待ち row whose take was never secured can be cleared by nobody — the
  // unclearable 要対応 badge this family has already been burned by. The exit is
  // an argument only the inbox passes, so a future automatic caller has to
  // WRITE it to get past the guard; there is exactly one such call site.
  it('…and its one exit is the inbox row a human settled, nowhere else', () => {
    const store = code('src/lib/karute/take-store.ts')
    expect(store).toContain('opts?: { humanResolved?: boolean }')
    const view = code('src/components/karute/redesign/record/RecordPageView.tsx')
    expect(view.match(/humanResolved: true/g)).toHaveLength(1)
    expect(view).toContain('deleteTake(row.takeId, { humanResolved: true })')
    // No other module in the app may reach for it.
    for (const rel of [
      'src/lib/global-pipeline.ts',
      'src/lib/recording/discard-transcript.ts',
      'src/components/recording/ProcessingIndicator.tsx',
    ]) {
      expect(code(rel)).not.toContain('humanResolved')
    }
  })

  it('…and a refused prune is a VISIBLE take, never a swallowed one', () => {
    const store = code('src/lib/karute/take-store.ts')
    // The TTL branch returns only takes deleteTake will actually take; the rest
    // fall through to the list carrying the flag 録音履歴 renders them from.
    expect(store).toContain('if (expired && m.finalizedAt) {')
    expect(store).toContain('expiredUnsecured: expired || undefined')
    expect(code('src/lib/recordings/inbox.ts')).toContain('strandedTakes')
  })

  it('session cleanup refuses a row whose audio still exists', () => {
    const src = code('src/lib/recording/session-cleanup.ts')
    // The POINTER is no longer the question — every born-reserved row has one.
    expect(src).toContain("if (row.status !== 'RECORDING')")
    expect(src).toContain('await objectExists(row.audio_storage_path)')
    expect(src).toContain("return { error: 'has_audio' }")
  })

  it('the mint never defaults a CLIENT-NAMED take’s container', () => {
    const src = code('src/lib/recording/mint-take-url.ts')
    // `?? DEFAULT_MIME` on a take the client named would compose the wrong
    // extension onto the one object the whole pipeline reads — and finalize,
    // which composes from the same pair, would agree with it. Only a
    // server-named take (no takeId, so no mimeType) keeps the default.
    expect(src).toContain('const mimeType = input.mimeType ?? (input.takeId ? null : DEFAULT_MIME)')
    expect(src).not.toContain('const mimeType = input.mimeType ?? DEFAULT_MIME')
  })

  it('the discard transcript reads the ROW’s key, not the caller’s claim', () => {
    const src = code('src/actions/recording-discard-transcript.ts')
    expect(src).toContain('const pointer = recording?.audio_storage_path ?? null')
    expect(src).toContain('const audioPath = pointer ?? input.audioPath')
    expect(src).toContain('.createSignedUrl(audioPath, 3600)')
  })

  it('the ONE exemption is voice enrolment, and it is fenced at runtime', () => {
    const src = code('src/actions/voice.ts')
    // The positive prefix match is what makes it an exemption rather than a
    // hole: only THIS staffer's own enrolment keys can reach the remove.
    expect(src).toContain('const ownPrefix = `voice-enroll/${businessId}/${staffId}`')
    expect(src).toContain('p.startsWith(ownPrefix)')
  })

  it('the CI guard and its selftest exist and name that one exemption', () => {
    const guard = read('scripts/audit/check-audio-never-deleted.mjs')
    expect(guard).toContain("file: 'src/actions/voice.ts'")
    expect(guard).toContain("symbol: 'revokeVoiceActionCore'")
    expect(existsSync(join(process.cwd(), 'scripts/audit/check-audio-never-deleted.selftest.mjs')))
      .toBe(true)
    // …and CI runs both, or the guard is a file nobody executes.
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('node scripts/audit/check-audio-never-deleted.mjs')
    expect(ci).toContain('node scripts/audit/check-audio-never-deleted.selftest.mjs')
  })
})
