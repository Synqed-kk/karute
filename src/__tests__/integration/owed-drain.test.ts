/**
 * ⚖ THE DRAIN LOOP, LIFTED (capture pipeline slice five, packet A / D2).
 *
 * The loop, the lock and the "still owed?" read used to live inside
 * RecordPageView's mount effect. They are now a module of their own, because
 * the phone's launch runner (thin/data/launch-drain.ts) has to share the SAME
 * lock: a staffer navigating onto the record page while the launch drain is
 * still working would otherwise put two whole takes — tens of megabytes each —
 * on salon wifi at once, which is the exact starvation the loop is sequential
 * to prevent.
 *
 * record-mount-drain-sequential.test.tsx pins the same behaviour through the
 * PAGE (its scheduler, its remount lock). This file pins the module directly,
 * which is the only way to reach the two answers the page reads back:
 * `busy` and `stillOwed`.
 */

/** Every take the drain reached, in order, plus the high-water mark of how many
 *  ran AT ONCE — the sequential half of the assertion. */
const secured: string[] = []
let live = 0
let mostAtOnce = 0

/** What the store answers. `owed` is the ELIGIBLE list; `cooling` is what the
 *  cooldown is hiding, which only the includeCoolingDown read sees. */
let owed: string[] = []
let cooling: string[] = []
/** Held across a macrotask, so two runs started together would overlap. */
let secureThrows = false

jest.mock('@/lib/karute/take-store', () => ({
  listOwnStoppedUnsecuredTakeIds: jest.fn(
    async (includeCoolingDown?: boolean) => (includeCoolingDown ? [...owed, ...cooling] : owed),
  ),
}))
jest.mock('@/lib/ports/recording-port', () => ({
  getRecordingPipelinePort: jest.fn(() => ({ port: true })),
}))
jest.mock('@/lib/recording/secure-take', () => ({
  secureTake: jest.fn(async (_port: unknown, takeId: string) => {
    secured.push(takeId)
    live += 1
    mostAtOnce = Math.max(mostAtOnce, live)
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
    live -= 1
    if (secureThrows) throw new Error('secure blew up (test)')
    owed = owed.filter((id) => id !== takeId)
  }),
}))

import { listOwnStoppedUnsecuredTakeIds } from '@/lib/karute/take-store'
import { secureTake } from '@/lib/recording/secure-take'
import { drainOwedTakes } from '@/lib/recording/owed-drain'

beforeEach(() => {
  secured.length = 0
  live = 0
  mostAtOnce = 0
  owed = []
  cooling = []
  secureThrows = false
  jest.mocked(listOwnStoppedUnsecuredTakeIds).mockClear()
  jest.mocked(secureTake).mockClear()
})

describe('drainOwedTakes', () => {
  it('secures the whole worklist ONE AT A TIME, in order', async () => {
    owed = ['take-a', 'take-b', 'take-c']

    const r = await drainOwedTakes()

    expect(mostAtOnce).toBe(1)
    expect(secured).toEqual(['take-a', 'take-b', 'take-c'])
    expect(r).toEqual({ busy: false, stillOwed: false })
  })

  it('hands the isActive probe to BOTH the worklist and secureTake', async () => {
    // Fix round 13: inside the phone's single WebView the store may name a take
    // whose stop stamp never landed, and the recorder singleton is the only
    // thing that can tell that from a take a page is still capturing.
    owed = ['take-a']
    const isActive = (id: string) => id === 'nobody'

    await drainOwedTakes(isActive)

    expect(listOwnStoppedUnsecuredTakeIds).toHaveBeenNthCalledWith(1, false, isActive)
    expect(secureTake).toHaveBeenCalledWith({ port: true }, 'take-a', undefined, isActive)
    expect(listOwnStoppedUnsecuredTakeIds).toHaveBeenNthCalledWith(2, true, isActive)
  })

  it('answers BUSY while another run holds the lock — and does nothing else', async () => {
    // ⚖ ONE LOCK, ACROSS CALLERS. This is the whole reason the loop was lifted:
    // the page's mount effect and the phone's launch runner are two doors onto
    // one worklist, and a second runner beside the first is two whole takes on
    // the wire.
    owed = ['take-a', 'take-b']
    const first = drainOwedTakes()
    // Same tick — the lock is taken synchronously, before the first run has
    // even read its worklist.
    const second = await drainOwedTakes()

    expect(second).toEqual({ busy: true })

    expect(await first).toEqual({ busy: false, stillOwed: false })
    // The loser started NOTHING of its own: each take was secured exactly once,
    // and never two at a time. Drop the guard and this reads
    // ['take-a', 'take-a', 'take-b', 'take-b'] with mostAtOnce 2 — two whole
    // recordings on salon wifi, starving each other.
    expect(secured).toEqual(['take-a', 'take-b'])
    expect(mostAtOnce).toBe(1)
  })

  it('answers stillOwed when the COOLING-DOWN list is not empty', async () => {
    // The eligible list is empty both when everything is safely on the server
    // and when everything failed a minute ago. Stopping on that would end the
    // retry at the moment it became necessary — so the flagged read is what
    // decides whether the caller keeps looking.
    cooling = ['take-failed-a-minute-ago']

    const r = await drainOwedTakes()

    expect(secured).toEqual([])
    expect(r).toEqual({ busy: false, stillOwed: true })
  })

  it('…and false when BOTH lists are empty — nothing is waiting for us', async () => {
    expect(await drainOwedTakes()).toEqual({ busy: false, stillOwed: false })
  })

  it('a THROWING secureTake releases the lock — the next run is not locked out for ever', async () => {
    // The `finally` is the whole assertion. Without it one thrown upload — a
    // port that rejects, a store that died mid-loop — leaves `running` true for
    // the life of the tab and NOTHING drains again, on either door.
    owed = ['take-a']
    secureThrows = true
    await expect(drainOwedTakes()).rejects.toThrow('secure blew up (test)')

    secureThrows = false
    owed = ['take-b']
    const r = await drainOwedTakes()

    expect(r).toEqual({ busy: false, stillOwed: false })
    expect(secured).toEqual(['take-a', 'take-b'])
  })
})
