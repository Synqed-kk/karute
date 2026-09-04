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
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'

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

/** EVERY non-test source file under src/ — the census's reach for a rule that
 *  has to hold in the whole app, not only in the files this suite names. */
const srcFiles = () =>
  (readdirSync(join(process.cwd(), 'src'), { recursive: true, encoding: 'utf8' }) as string[])
    .map((r) => `src/${r.split(sep).join('/')}`)
    .filter((rel) => /\.tsx?$/.test(rel) && !rel.includes('/__tests__/'))

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

  // ⚖ ITS EXITS ARE SETTLED SAVES, AND ONE RULE DECIDES THEM (fix rounds 1, 2,
  // 3 and 4). The guard needs a way out or a 確認待ち row whose take was never
  // secured can be cleared by nobody — the unclearable 要対応 badge this family
  // has already been burned by. THREE call sites reach it, each one downstream
  // of a karute record already on the server carrying this take's own words:
  // 確認する on the inbox row (round 1), 保存する on the stranded/recovery row
  // (round 2), and the in-tab autosave's settle (round 3).
  //
  // Round 4 takes the DECISION off all three. They used to write
  // `humanResolved: true` as a constant, which was false for a take whose
  // secure failed retryably — no finalized key, a row-less staged copy, and the
  // constant destroying the only audio the drain could still seal. The flag is
  // now computed in ONE place from the take itself, and no call site may write
  // it: the census below is over the WHOLE of src/, not the three files here,
  // because a fourth exit added tomorrow is exactly what this pins.
  it('…and its three exits all route through the ONE rule — no call site writes the flag', () => {
    const store = code('src/lib/karute/take-store.ts')
    expect(store).toContain('opts?: { humanResolved?: boolean }')
    // The rule: the take is READ, and only a take that can never be sealed
    // (or a finalized one, which needs no flag at all) is settled.
    expect(store).toContain('export async function settleTakeAfterSave(takeId: string)')
    expect(store).toContain('const meta = await readTakeSecureMeta(takeId)')
    expect(store).toContain(
      'return deleteTake(takeId, { humanResolved: !!meta && isUnsecurableTake(meta) })',
    )

    const view = code('src/components/karute/redesign/record/RecordPageView.tsx')
    expect(view).toContain('settleTakeAfterSave(row.takeId).then(() => loadInbox())')
    expect(view).toContain('settleTakeAfterSave(d.takeId)')
    const indicator = code('src/components/recording/ProcessingIndicator.tsx')
    expect(indicator).toContain('settleTakeAfterSave(ctx.takeId)')

    // ⚖ AND THE CONSTANT IS GONE FROM THE APP. Comments are stripped by
    // `code`, so prose about the flag is not the flag.
    const writers = srcFiles().filter((rel) => /humanResolved:\s*true/.test(code(rel)))
    expect(writers).toEqual([])
    // No other module may reach for the flag at all.
    for (const rel of ['src/lib/global-pipeline.ts', 'src/lib/recording/discard-transcript.ts']) {
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

  // Fix round 3 amends the second line only: the row's key still wins, but a
  // RESERVATION whose object never landed is not a key — it is a promise the
  // take could not keep, and the caller's staged copy is the only audio there
  // is. Storage answers that, because no field on the row can (the mint writes
  // the pointer and UPLOADING, finalize writes UPLOADING back, and the discard
  // stamps the duration itself).
  it('the discard transcript reads the ROW’s key, not the caller’s claim', () => {
    const src = code('src/actions/recording-discard-transcript.ts')
    expect(src).toContain('const pointer = recording?.audio_storage_path ?? null')
    expect(src).toContain('let audioPath = pointer ?? input.audioPath')
    expect(src).toContain(
      "if (pointer && pointer !== input.audioPath && (await objectExists(pointer)) === false) {",
    )
    expect(src).toContain('.createSignedUrl(audioPath, 3600)')
    // ONE home for "does this object exist", shared with both mints.
    expect(src).toContain("import { objectExists } from '@/lib/recording/mint-take-url'")
  })

  // ⚖ …AND THE SECOND UPLOAD OF THE SAME TAKE IS GONE TOO (fix round 2). Both
  // readers of the finalized key wait for the stop's own leg before they read
  // it; without that the staging fallback — which exists for a take the store
  // never held — ran on EVERY ordinary recording.
  // Fix round 5 adds the THIRD reader: the discard's own word-collection was
  // kicked at the discard instant by both of its arms, read the row before the
  // PUT landed, and left the words to a record-page mount that might never come.
  it('every reader of the finalized key waits for the stop’s leg first', () => {
    for (const rel of [
      'src/lib/global-pipeline.ts',
      'src/lib/ai-pipeline.ts',
      'src/lib/recording/discard-transcript.ts',
    ]) {
      // Lazily imported in both, for the reason recording-port already names:
      // the recorder's graph reaches @/actions/recordings → next/cache.
      expect(code(rel)).toContain(
        "await (await import('@/lib/global-recorder')).globalRecorder.awaitTakeSecured(takeId)",
      )
    }
    const rec = code('src/lib/global-recorder.ts')
    // It waits on the LEG, not on the hold — the hold is released before
    // secureTake runs, so it is already gone for the whole of the upload.
    expect(rec).toContain('const leg = this.stopLegs.get(takeId)')
    expect(rec).toContain('this.stopLegs.set(')
    // …and the wait has a ceiling, so a leg that never exits cannot pin a
    // recording the staffer is waiting to finish.
    expect(rec).toContain('const SECURE_SETTLE_BELT_MS = 120_000')
    expect(rec).toContain('belt = setTimeout(resolve, SECURE_SETTLE_BELT_MS)')
  })

  // ⚖ …AND A DISCARD'S WORDS SURVIVE A TAKE THAT CAN NEVER BE SEALED (fix
  // round 2). The early return on a missing finalized key is now asked one
  // question first, and the staging it falls to is the PORT's own — there is no
  // second spelling of an upload in the discard path, and still no delete.
  it('the discard’s word-collection stages an unsecurable take through the port', () => {
    const src = code('src/lib/recording/discard-transcript.ts')
    expect(src).toContain('if (!isUnsecurableTake(meta)) return')
    expect(src).toContain(
      'path = (await getRecordingPipelinePort().prepareTranscription(blob, null)).path',
    )
    expect(src).not.toContain('.remove(')
    // The rule itself lives beside the two facts it is made of, not here.
    const store = code('src/lib/karute/take-store.ts')
    expect(store).toContain('export function isUnsecurableTake(')
    expect(store).toContain('if (meta.tailIncomplete) return true')
    expect(store).toContain(
      'if (meta.stopPendingAt !== undefined && meta.durationMs === undefined) return true',
    )
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
    // …and it sees the two shapes fix round 4 added: a delete lifted off the
    // handle by NAME, and emptying the whole bucket. Both live in one list, so
    // a third spelling is added in one place.
    expect(guard).toContain("const DELETE_METHODS = new Set(['remove', 'emptyBucket'])")
    expect(existsSync(join(process.cwd(), 'scripts/audit/check-audio-never-deleted.selftest.mjs')))
      .toBe(true)
    // …and CI runs both, or the guard is a file nobody executes.
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('node scripts/audit/check-audio-never-deleted.mjs')
    expect(ci).toContain('node scripts/audit/check-audio-never-deleted.selftest.mjs')
  })
})
