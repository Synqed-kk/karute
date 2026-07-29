/** @jest-environment jsdom */
// useAiSlot + ai-slot-cache — the thin AI cards' session memory (Liam ruling
// 2026-07-29 D: instant reopen). The load-bearing pin is the AUTHORITATIVE-
// NULL case (blind-round P1): a SUCCESSFUL response whose payload carries no
// card must clear both cache and state — without it, a draft grounded in a
// deliberately DELETED summary keeps pre-filling the outreach send dialog.
// Failures (non-2xx, network) must instead change nothing ("can never look
// worse" applies to failures only).
import { act, render, screen } from '@testing-library/react'

const apiFetch = jest.fn<Promise<{ ok: boolean; json: () => Promise<unknown> }>, [string]>()
jest.mock('@/lib/ports/data-port', () => ({
  getDataPort: () => ({ apiFetch: (p: string) => apiFetch(p) }),
}))

import { useAiSlot } from '@/lib/karute/use-ai-slot'
import { setAiSlot, getAiSlot, clearAiSlotCache } from '@/lib/karute/ai-slot-cache'

type Draft = { body: string }
const pick = (b: unknown) => (b as { draft?: Draft | null } | null)?.draft ?? null

function Probe({ path }: { path: string | null }) {
  const draft = useAiSlot<Draft>(path, pick)
  return <div data-testid="out">{draft ? draft.body : 'PREVIEW'}</div>
}

const ok = (payload: unknown) => ({ ok: true, json: async () => payload })
const fail = () => ({ ok: false, json: async () => ({}) })

// One resolvable-later fetch so assertions can look BETWEEN mount and settle.
function deferred() {
  let resolve!: (v: { ok: boolean; json: () => Promise<unknown> }) => void
  const promise = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  jest.clearAllMocks()
  clearAiSlotCache()
})

it('cached value renders SYNCHRONOUSLY before the fetch settles (instant reopen)', async () => {
  setAiSlot('/p1', { body: 'cached!' })
  const d = deferred()
  apiFetch.mockReturnValue(d.promise)
  render(<Probe path="/p1" />)
  // No await — the very first paint must already show the cached draft.
  expect(screen.getByTestId('out').textContent).toBe('cached!')
  await act(async () => d.resolve(ok({ draft: { body: 'cached!' } })))
})

it('successful fetch stores + swaps the value', async () => {
  apiFetch.mockResolvedValue(ok({ draft: { body: 'fresh' } }))
  render(<Probe path="/p2" />)
  expect(screen.getByTestId('out').textContent).toBe('PREVIEW')
  await act(async () => {})
  expect(screen.getByTestId('out').textContent).toBe('fresh')
  expect(getAiSlot('/p2')).toEqual({ body: 'fresh' })
})

it('AUTHORITATIVE NULL (200, no draft) clears cache AND state — deleted-summary draft cannot stick', async () => {
  setAiSlot('/p3', { body: 'stale draft from a deleted summary' })
  apiFetch.mockResolvedValue(ok({ draft: null }))
  render(<Probe path="/p3" />)
  expect(screen.getByTestId('out').textContent).toBe('stale draft from a deleted summary')
  await act(async () => {})
  expect(screen.getByTestId('out').textContent).toBe('PREVIEW')
  expect(getAiSlot('/p3')).toBeUndefined()
})

it('FAILED fetch (non-2xx) keeps the cached value — failures never make the card worse', async () => {
  setAiSlot('/p4', { body: 'still good' })
  apiFetch.mockResolvedValue(fail())
  render(<Probe path="/p4" />)
  await act(async () => {})
  expect(screen.getByTestId('out').textContent).toBe('still good')
  expect(getAiSlot('/p4')).toEqual({ body: 'still good' })
})

it('network reject keeps the cached value', async () => {
  setAiSlot('/p5', { body: 'survives offline' })
  apiFetch.mockRejectedValue(new Error('offline'))
  render(<Probe path="/p5" />)
  await act(async () => {})
  expect(screen.getByTestId('out').textContent).toBe('survives offline')
})

it('null path renders preview and never fetches (body-prediction without customer)', async () => {
  render(<Probe path={null} />)
  await act(async () => {})
  expect(screen.getByTestId('out').textContent).toBe('PREVIEW')
  expect(apiFetch).not.toHaveBeenCalled()
})

it('cache caps at 50 by FIFO — oldest key evicted, cap never exceeded', () => {
  for (let i = 0; i < 51; i++) setAiSlot(`/k${i}`, { body: `v${i}` })
  expect(getAiSlot('/k0')).toBeUndefined()
  expect(getAiSlot('/k1')).toEqual({ body: 'v1' })
  expect(getAiSlot('/k50')).toEqual({ body: 'v50' })
})

it('clearAiSlotCache empties everything (the sign-out wipe hook)', () => {
  setAiSlot('/a', { body: 'x' })
  setAiSlot('/b', { body: 'y' })
  clearAiSlotCache()
  expect(getAiSlot('/a')).toBeUndefined()
  expect(getAiSlot('/b')).toBeUndefined()
})

// Greptile #649 (logout repopulation race): a fetch started BEFORE the
// sign-out wipe resolves AFTER it — its response must touch NOTHING, or the
// previous user's content re-fills the freshly wiped cache on a shared
// device. The epoch fence makes every pre-wipe response a no-op.
it('a fetch resolving AFTER a sign-out wipe cannot repopulate the cache', async () => {
  const d = deferred()
  apiFetch.mockReturnValue(d.promise)
  render(<Probe path="/race" />)
  clearAiSlotCache() // sign-out wipe while the fetch is still in flight
  await act(async () => d.resolve(ok({ draft: { body: 'prev user secret' } })))
  expect(getAiSlot('/race')).toBeUndefined()
})

// r2 narrowing: the fence must also cover REACT STATE — a late response in
// the wipe→unmount gap may not paint the outgoing session's content on the
// still-mounted screen, not even momentarily.
it('a fetch resolving AFTER a sign-out wipe cannot update the rendered value either', async () => {
  const d = deferred()
  apiFetch.mockReturnValue(d.promise)
  render(<Probe path="/race3" />)
  expect(screen.getByTestId('out').textContent).toBe('PREVIEW')
  clearAiSlotCache() // wipe fires; component not yet unmounted
  await act(async () => d.resolve(ok({ draft: { body: 'prev user secret' } })))
  expect(screen.getByTestId('out').textContent).toBe('PREVIEW')
})

it('a pre-wipe authoritative null cannot delete the NEXT session\'s fresh entry', async () => {
  const d = deferred()
  apiFetch.mockReturnValue(d.promise)
  render(<Probe path="/race2" />)
  clearAiSlotCache()
  setAiSlot('/race2', { body: 'next user fresh value' }) // new session repopulated
  await act(async () => d.resolve(ok({ draft: null })))
  expect(getAiSlot('/race2')).toEqual({ body: 'next user fresh value' })
})
