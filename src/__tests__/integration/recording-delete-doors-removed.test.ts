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

/** The two components that own a take: the record page and the autosave chip.
 *  Every remaining delete door in the app's own code is in one of these. */
const VIEW = 'src/components/karute/redesign/record/RecordPageView.tsx'
const INDICATOR = 'src/components/recording/ProcessingIndicator.tsx'

/** ONE handler's body: from the line that opens it to the first line that is
 *  EXACTLY its closing brace. Both files declare every handler at one fixed
 *  indent, so this needs no parser — and a rename THROWS here rather than
 *  quietly censusing an empty string, which is the way a source census dies. */
const handlerBody = (src: string, open: string, close = '  }') => {
  const lines = src.split('\n')
  const start = lines.findIndex((l) => l.includes(open))
  if (start < 0) throw new Error(`handler not found: ${open}`)
  const end = lines.findIndex((l, i) => i > start && l === close)
  if (end < 0) throw new Error(`handler never closed: ${open}`)
  return lines.slice(start, end + 1).join('\n')
}

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
  // 3, 4 and 6). The guard needs a way out or a 確認待ち row whose take was never
  // secured can be cleared by nobody — the unclearable 要対応 badge this family
  // has already been burned by. FOUR call sites reach it, each one downstream of
  // a karute record already on the server carrying this take's own words:
  // 確認する on the inbox row (round 1), 保存する on the stranded/recovery row
  // (round 2), the in-tab autosave's settle (round 3), and ReviewScreen's own
  // 保存 (round 6 — the LAST one still deleting, and the one a walk-in normally
  // takes, since the autosave gate needs an appointment customer).
  //
  // Round 4 takes the DECISION off all of them. They used to write
  // `humanResolved: true` as a constant, which was false for a take whose
  // secure failed retryably — no finalized key, a row-less staged copy, and the
  // constant destroying the only audio the drain could still seal. The flag is
  // now computed in ONE place from the take itself, and no call site may write
  // it: the census below is over the WHOLE of src/, not the files named here.
  //
  // ⚠ AND THAT CENSUS IS WHY ROUND 6 WAS NEEDED. Banning the CONSTANT is not
  // banning the DELETE: onSaved never wrote a flag, it just called deleteTake,
  // and read green here for two rounds. So the exits are now pinned BY HANDLER
  // — a save path must contain the settle AND must not contain a delete — and
  // the delete calls themselves are counted in the case below.
  it('…and its FOUR exits all route through the ONE rule — no save path deletes', () => {
    const store = code('src/lib/karute/take-store.ts')
    expect(store).toContain('opts?: { humanResolved?: boolean }')
    // The rule: the take is READ, and only a take that can never be sealed
    // (or a finalized one, which needs no flag at all) is settled.
    expect(store).toContain('export async function settleTakeAfterSave(takeId: string)')
    expect(store).toContain('const meta = await readTakeSecureMeta(takeId)')
    expect(store).toContain(
      'return deleteTake(takeId, { humanResolved: !!meta && isUnsecurableTake(meta) })',
    )

    const view = code(VIEW)
    // Sliced by handler, and asserted BOTH ways round: "the file contains a
    // settle" is what the old census asked, and a save exit that settles one
    // take while deleting another passes it.
    for (const [exit, body] of [
      ['確認する on the inbox row', handlerBody(view, 'function handleInboxOpenRecord(')],
      ['保存する on the recovery/inbox row', handlerBody(view, 'async function commitRecoverySave(')],
      ['ReviewScreen’s onSaved', handlerBody(view, 'onSaved={() => {', '          }}')],
    ] as const) {
      expect([exit, body.includes('settleTakeAfterSave(')]).toEqual([exit, true])
      expect([exit, body.includes('deleteTake(')]).toEqual([exit, false])
    }
    // The exact spellings, so a settle cannot quietly change which take it
    // settles while the handler slice above still reads green.
    expect(view).toContain('settleTakeAfterSave(row.takeId).then(() => loadInbox())')
    expect(view).toContain('settleTakeAfterSave(d.takeId)')
    expect(view).toContain(
      'if (pipeline.context?.takeId) void settleTakeAfterSave(pipeline.context.takeId)',
    )

    // The fourth exit has no named handler to slice — it is an anonymous run
    // inside ProcessingIndicator's autosave effect — so the FILE is the fence,
    // which it can be: this component owns no other take door at all.
    const indicator = code(INDICATOR)
    expect(indicator).toContain('if (ctx.takeId) void settleTakeAfterSave(ctx.takeId)')
    expect(indicator).not.toContain('deleteTake(')

    // ⚖ AND THE CONSTANT IS GONE FROM THE APP. Comments are stripped by
    // `code`, so prose about the flag is not the flag.
    const writers = srcFiles().filter((rel) => /humanResolved:\s*true/.test(code(rel)))
    expect(writers).toEqual([])
    // No other module may reach for the flag at all.
    for (const rel of ['src/lib/global-pipeline.ts', 'src/lib/recording/discard-transcript.ts']) {
      expect(code(rel)).not.toContain('humanResolved')
    }
  })

  // ⚖ …AND EVERY BARE DELETE THAT REMAINS IS A DISCARD THAT MARKED FIRST (fix
  // round 6). This is the half the flag census could not do: it counts the
  // CALLS, so a delete that appears anywhere new in these two files fails here
  // whether or not it carries a flag, and the three that stay have to keep
  // being the three discard arms — each of which stamps the take before the
  // delete, so a thrown-away session is never re-offered.
  it('the only bare deleteTake left in the two take-owning components is a MARKED discard', () => {
    const bare = (rel: string) =>
      code(rel)
        .split('\n')
        .filter((l) => l.includes('deleteTake('))
        .map((l) => l.trim())

    expect(bare(VIEW)).toEqual([
      'void deleteTake(ctx.takeId)', // the pipeline-error arm
      'void deleteTake(bannerSnap.takeId)', // the ⚖ 8/26 below-floor banner arm
      'if (takeId) void deleteTake(takeId)', // finishReviewDiscard, called from the review arm
    ])
    expect(bare(INDICATOR)).toEqual([])

    const view = code(VIEW)
    // Arms 1 and 2 mark the take on the line ABOVE their delete — adjacency is
    // the assertion, because a mark that drifts away from the delete is a
    // window in which a crash leaves the take alive and offerable again.
    expect(view).toContain(
      [
        '        if (ctx?.takeId) {',
        '          await markDiscardedNoWords(ctx.takeId, ctx.duration ?? 0)',
        '          void deleteTake(ctx.takeId)',
        '        }',
      ].join('\n'),
    )
    expect(view).toContain(
      [
        '        await markDiscardedNoWords(bannerSnap.takeId, bannerSnap.durationSec, true)',
        '        void deleteTake(bannerSnap.takeId)',
      ].join('\n'),
    )
    // Arm 3 takes its take id as a PARAMETER, so its mark is at its one call
    // site, not in its body: the id reaches the delete only when
    // persistReviewDiscardTranscript already stamped the take AND settled it
    // (keepTake false). A failed persist hands it null — the audio is kept and
    // the retry still has something to read.
    expect(handlerBody(view, 'function finishReviewDiscard(')).toContain(
      'if (takeId) void deleteTake(takeId)',
    )
    expect(view).toContain(
      [
        '        const keepTake = !(await persistReviewDiscardTranscript(',
        '          ctx?.takeId,',
        '          pending,',
        "          globalPipeline.result?.transcript ?? '',",
        '        ))',
        '        setDiscardReasonFor(null)',
        '        finishReviewDiscard(recordingSessionId, keepTake ? null : ctx?.takeId)',
      ].join('\n'),
    )
    // …and that IS its only call site, so the pin above is the whole story
    // (one declaration + one call = two occurrences).
    expect(view.split('finishReviewDiscard(').length - 1).toBe(2)
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
  // Fix round 7 amends it once more: the claim that stands in for an empty
  // reservation must be THIS SESSION'S OWN staged copy, proven by the key
  // (stg/<biz>_<session>_<uuid>), never any same-tenant key the caller typed.
  it('the discard transcript reads the ROW’s key, not the caller’s claim', () => {
    const src = code('src/actions/recording-discard-transcript.ts')
    expect(src).toContain('const pointer = recording?.audio_storage_path ?? null')
    expect(src).toContain('let audioPath = input.audioPath')
    expect(src).toContain(
      "if (pointer && (pointer === input.audioPath || (await objectExists(pointer)) !== false)) {",
    )
    // …and the ONLY other way out of that branch is the session-bound claim.
    expect(src).toContain('} else if (!ownStaged) {')
    expect(src).toContain("return { error: 'forbidden' }")
    expect(src).toContain('const ownStaged = isStagedKeyFor(')
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
    // …and the copy it stages NAMES the session it is staged for (fix round 7),
    // which is the identity a row-less object otherwise has none of.
    expect(src).toContain(
      "path = (await port.prepareTranscription(blob, null, { stagedFor: pending.recordingSessionId }))",
    )
    expect(src).toContain('const port = getRecordingPipelinePort()')
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
