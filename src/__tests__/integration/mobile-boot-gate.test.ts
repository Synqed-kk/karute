/**
 * Boot-timeout state machine (PLAN §4, packet-01 point 2). The security-relevant
 * invariant: first paint NEVER blocks unbounded on getSession() (which hangs
 * offline per the spike), and a transient failure NEVER looks like a real
 * logout. Uses tiny real timers — no fake-timer/microtask dance.
 */
import { bootSessionGate, type BootState } from '@/lib/auth/mobile/boot-gate'

type S = { token: string }
const session: S = { token: 'abc' }

const deferred = <T>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('bootSessionGate', () => {
  it('recover resolves a session fast → signed-in (timeout never fires)', async () => {
    const state = await bootSessionGate<S>(async () => session, 50)
    expect(state).toEqual({ status: 'signed-in', session })
  })

  it('recover resolves null fast → signed-out', async () => {
    const state = await bootSessionGate<S>(async () => null, 50)
    expect(state).toEqual({ status: 'signed-out' })
  })

  it('recover HANGS → recovering after the timeout, no false state', async () => {
    const onSettled = jest.fn()
    const state = await bootSessionGate<S>(() => new Promise<S | null>(() => {}), 20, onSettled)
    expect(state).toEqual({ status: 'recovering' })
    await new Promise((r) => setTimeout(r, 40))
    expect(onSettled).not.toHaveBeenCalled() // a hang never settles
  })

  it('slow recovery → recovering immediately, onSettled reports signed-in later', async () => {
    const d = deferred<S | null>()
    const settled: BootState<S>[] = []
    const state = await bootSessionGate<S>(() => d.promise, 20, (s) => settled.push(s))
    expect(state).toEqual({ status: 'recovering' })
    d.resolve(session)
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toEqual([{ status: 'signed-in', session }])
  })

  it('transient reject → recovering, NEVER signed-out (no false logout)', async () => {
    const state = await bootSessionGate<S>(async () => {
      throw new Error('offline: GoTrue unreachable')
    }, 50)
    expect(state).toEqual({ status: 'recovering' })
  })

  it('reject AFTER timeout fall-through does not flip an already-painted UI to logged-out', async () => {
    const d = deferred<S | null>()
    const onSettled = jest.fn()
    const state = await bootSessionGate<S>(() => d.promise, 20, onSettled)
    expect(state).toEqual({ status: 'recovering' })
    d.reject(new Error('offline'))
    await new Promise((r) => setTimeout(r, 10))
    expect(onSettled).not.toHaveBeenCalled()
  })
})
