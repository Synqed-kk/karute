/**
 * resolveTakeAudio (src/lib/recording/take-audio.ts) — the ONE precedence every
 * reader of a take's audio shares (⚖ Liam 2026-09-06, "b").
 *
 * What only this file can prove, because the doors above it are about their own
 * fences and not about this order:
 *   1. the PHONE'S OBJECT WINS whenever it exists — the rescue is a prefix and
 *      the device's copy is the whole take;
 *   2. the rescue is reached only from a PROVEN miss, never from a blip: an
 *      'unknown' at the phone's key is 'unknown', full stop;
 *   3. neither probe is paid for twice — a present take costs ONE call.
 *
 * The probe is stubbed at the module seam every door already shares
 * (`objectExists`, mint-take-url.ts), so nothing here reaches storage.
 */
const objectExists = jest.fn<Promise<boolean | 'unknown'>, [string]>()
jest.mock('@/lib/recording/mint-take-url', () => ({
  objectExists: (key: string) => objectExists(key),
}))

import { resolveTakeAudio } from '@/lib/recording/take-audio'
import { composeRescueKey, composeTakeKey } from '@/lib/recording/key-grammar'

const BIZ = 'biz-1'
const TAKE = '0f8c6c9a-3f2d-4a71-9b5e-2c1d7e4a8b30'
const MAIN = composeTakeKey(BIZ, TAKE, 'audio/mp4')!.key
const RESCUE = composeRescueKey(BIZ, TAKE, 'audio/mp4')!.key

beforeEach(() => jest.clearAllMocks())

/** `answers[key]` — the bucket, as this helper can see it. */
function bucket(answers: Record<string, boolean | 'unknown'>) {
  objectExists.mockImplementation(async (key) => answers[key] ?? false)
}

describe('resolveTakeAudio — the phone’s object first, the rescue second', () => {
  it('signs the PHONE’S key when its object is there', async () => {
    bucket({ [MAIN]: true, [RESCUE]: true })
    await expect(resolveTakeAudio(BIZ, TAKE, 'mp4')).resolves.toEqual({
      key: MAIN,
      rescued: false,
    })
    // …and the rescue is never even asked about: the full take won on the
    // first call. Both objects DO exist here — a paused phone that came back —
    // so this is the case where a wrong order silently downgrades a recording.
    expect(objectExists).toHaveBeenCalledTimes(1)
    expect(objectExists).toHaveBeenCalledWith(MAIN)
  })

  it('falls back to the RESCUE when the phone’s object is proven missing', async () => {
    bucket({ [MAIN]: false, [RESCUE]: true })
    await expect(resolveTakeAudio(BIZ, TAKE, 'mp4')).resolves.toEqual({
      key: RESCUE,
      rescued: true,
    })
    expect(objectExists.mock.calls.map((c) => c[0])).toEqual([MAIN, RESCUE])
  })

  it('answers `absent` only when BOTH are proven missing', async () => {
    bucket({ [MAIN]: false, [RESCUE]: false })
    await expect(resolveTakeAudio(BIZ, TAKE, 'mp4')).resolves.toBe('absent')
    expect(objectExists).toHaveBeenCalledTimes(2)
  })

  // ⚖ A BLIP IS NOT A MISS. Falling through here would hand the reader the
  // PARTIAL rescue while the device's whole take sat there unread — a silent
  // downgrade of somebody's recording, which is the one thing this order exists
  // to prevent.
  it('an `unknown` at the phone’s key is `unknown`, and the rescue is NEVER probed', async () => {
    bucket({ [MAIN]: 'unknown', [RESCUE]: true })
    await expect(resolveTakeAudio(BIZ, TAKE, 'mp4')).resolves.toBe('unknown')
    expect(objectExists).toHaveBeenCalledTimes(1)
    expect(objectExists).toHaveBeenCalledWith(MAIN)
  })

  it('an `unknown` at the RESCUE key is `unknown` too, never `absent`', async () => {
    bucket({ [MAIN]: false, [RESCUE]: 'unknown' })
    await expect(resolveTakeAudio(BIZ, TAKE, 'mp4')).resolves.toBe('unknown')
    expect(objectExists).toHaveBeenCalledTimes(2)
  })

  it('composes both candidates through the ONE grammar — never a caller’s string', async () => {
    bucket({})
    await resolveTakeAudio(BIZ, TAKE, 'webm')
    expect(objectExists.mock.calls.map((c) => c[0])).toEqual([
      composeTakeKey(BIZ, TAKE, 'audio/webm')!.key,
      composeRescueKey(BIZ, TAKE, 'audio/webm')!.key,
    ])
  })

  it('throws on a container the grammar cannot compose — a bug, never a miss', async () => {
    await expect(resolveTakeAudio(BIZ, TAKE, 'mpeg')).rejects.toThrow(
      'take audio key failed its own grammar',
    )
    expect(objectExists).not.toHaveBeenCalled()
  })
})
