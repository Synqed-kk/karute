/**
 * serverHoldsTakeRow (player fix round 1) — the one predicate that answers
 * "does the server actually HOLD this take's audio?", shared by the card's
 * presence (detail-screen.ts) and the playback mint (playback-url.ts).
 *
 * THE BUG IT CLOSES. The recording row is BORN RESERVED: session-mint.ts:179
 * creates it with `{ audio_storage_path, status: 'UPLOADING' }`, and
 * mint-take-url.ts:497-499 writes the same on a legacy row — both BEFORE a
 * single byte exists. So a pointer on the row means "this row claimed this
 * key", never "the bytes are here". Reading it as presence put a player on a
 * take still sitting on the device (secure retrying, or gone with the phone),
 * whose every tap could only answer 「再生できませんでした」.
 *
 * Only two things mean the object really landed: finalize-take.ts is the ONLY
 * writer that proves it (storage.info) before stamping a duration, and the
 * legacy job path's own statuses, whose rows were read by the worker.
 */
import {
  finalizedBefore,
  isJobOwnedStatus,
  serverHoldsTakeRow,
} from '@/lib/recording/take-binding'

const BIZ = 'biz-1'
const TAKE = '11111111-1111-4111-8111-111111111111'
const TAKE_KEY = `app_${BIZ}_${TAKE}.mp4`
const row = (over: Partial<Parameters<typeof serverHoldsTakeRow>[0]> = {}) => ({
  audio_storage_path: TAKE_KEY as string | null,
  duration_seconds: 742 as number | null,
  status: 'UPLOADING',
  ...over,
})

describe('serverHoldsTakeRow — the receipt half', () => {
  // THE REGRESSION. This is the exact row the mint leaves behind.
  it('a BORN-RESERVED row (key, UPLOADING, no duration) is NOT held', () => {
    expect(serverHoldsTakeRow(row({ duration_seconds: null }), BIZ)).toBe(false)
  })

  it('finalize’s own stamp (duration + a status the recorder left) IS held', () => {
    expect(serverHoldsTakeRow(row({ duration_seconds: 45 }), BIZ)).toBe(true)
  })

  it('a RECORDING row is never held, with or without a duration', () => {
    expect(serverHoldsTakeRow(row({ status: 'RECORDING', duration_seconds: null }), BIZ)).toBe(false)
    // The guard finalizedBefore has always carried: a live recorder owns this
    // row, whatever number happens to be on it.
    expect(serverHoldsTakeRow(row({ status: 'RECORDING', duration_seconds: 45 }), BIZ)).toBe(false)
  })

  it.each(['PROCESSING', 'COMPLETED', 'FAILED'])(
    'a job-owned %s row is held even with a null duration (the legacy worker path)',
    (status) => {
      expect(serverHoldsTakeRow(row({ status, duration_seconds: null }), BIZ)).toBe(true)
      expect(isJobOwnedStatus(status)).toBe(true)
    },
  )
})

describe('serverHoldsTakeRow — the fence half stays TAKE-only', () => {
  // ⚠ RE-WORDED (fix round 2): these pin THE FENCE — a non-take key is refused
  // — and make no claim about where a DISCARDED take's audio lives. The
  // ordinary discard keeps the row on its take key; stg/ is the exception.
  it.each([
    ['a null pointer', null],
    ['a stg/ staged key', `stg/${BIZ}_${TAKE}_${TAKE}.mp4`],
    ['a segment fragment of this tenant’s own take', `seg/app_${BIZ}_${TAKE}/000001.mp4`],
    ['another tenant’s take key', `app_other-biz_${TAKE}.mp4`],
  ])('%s is not held, however the duration and status read', (_name, path) => {
    expect(serverHoldsTakeRow(row({ audio_storage_path: path }), BIZ)).toBe(false)
    expect(serverHoldsTakeRow(row({ audio_storage_path: path, status: 'COMPLETED' }), BIZ)).toBe(false)
  })
})

// One spelling, both sides: finalize-take.ts imports this rather than keeping
// its own copy, so the READ side can never drift from the WRITE side's mark.
// ⚠ FIX ROUND 2 — the helper is a HEURISTIC and its header now says so. This
// pins the honest limit rather than a claim the repo refutes: a reasoned
// discard stamps the CLIENT-reported duration with no object proof
// (discard.ts#stampRecordingDuration), and the ORDINARY discard leaves the row
// on its take key. Such a row is true here — and the MINT's storage probe is
// what stops it becoming a signature.
describe('serverHoldsTakeRow — the named ceiling', () => {
  it('a discard-stamped row (take key, client duration, out of RECORDING) is TRUE here', () => {
    expect(serverHoldsTakeRow(row({ status: 'UPLOADING', duration_seconds: 47 }), BIZ)).toBe(true)
  })
})

describe('finalizedBefore is the shared mark, not a second spelling', () => {
  it('is exactly duration !== null AND status !== RECORDING', () => {
    expect(finalizedBefore({ duration_seconds: 1, status: 'UPLOADING' })).toBe(true)
    expect(finalizedBefore({ duration_seconds: null, status: 'UPLOADING' })).toBe(false)
    expect(finalizedBefore({ duration_seconds: 1, status: 'RECORDING' })).toBe(false)
  })
})
