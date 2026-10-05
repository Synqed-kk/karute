/** @jest-environment jsdom */
// ⚖ S66 R260 / P10 fix 1 (proof check 33) — a logo is accepted ONLY if the browser fully decodes it into pixels.
// Real Chromium 148 fires <img> load (512×512) for an 80-byte truncated PNG but createImageBitmap rejects it
// (L66/p10/decode-probe.json). The DEFAULT measure path is under test here (no `measure` seam): Image is stubbed to
// load with a well-formed header's size, and the decode call is mocked. A failed decode = the SAME type refusal (L1).
import { render, fireEvent, cleanup, screen, waitFor, act } from '@testing-library/react'
import { CardMarkBlock } from '@/app/[locale]/(business)/business/settings/CardMarkBlock'
import { MARK_REFUSAL } from '@/business/lib/store-page/card-mark'

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const GIF_HEAD = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]
const fileOf = (head: number[], name: string) => { const b = new Uint8Array(80); b.set(head); return new File([b], name, { type: 'image/png' }) }

let headerSide = 512
class LoadingImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  set src(_u: string) { setTimeout(() => { this.naturalWidth = headerSide; this.naturalHeight = headerSide; this.onload?.() }, 0) }
}

const g = globalThis as unknown as Record<string, unknown>
const saved = { Image: g.Image, createImageBitmap: g.createImageBitmap }
let revoked: string[] = []
let decode: jest.Mock
beforeEach(() => {
  revoked = []
  headerSide = 512
  let n = 0
  Object.assign(URL, { createObjectURL: () => `blob:mark-${++n}`, revokeObjectURL: (u: string) => { revoked.push(u) } })
  g.Image = LoadingImage
  decode = jest.fn()
  g.createImageBitmap = decode
})
afterEach(() => { cleanup(); Object.assign(g, saved) })

const mount = () => {
  const onMark = jest.fn()
  render(<CardMarkBlock practice onMark={onMark} />)
  const pick = (f: File) => fireEvent.change(screen.getByTestId('card-mark-file'), { target: { files: [f] } })
  return { onMark, pick }
}

it('d1 a well-formed PNG header whose decode FAILS is refused with the existing type refusal (L1), never accepted', async () => {
  decode.mockRejectedValue(new DOMException('The source image could not be decoded.', 'InvalidStateError'))
  const { onMark, pick } = mount()
  pick(fileOf(PNG_HEAD, 'cut.png'))
  expect(await screen.findByRole('alert')).toHaveTextContent(MARK_REFUSAL.type)
  expect(screen.queryByText('このロゴを使えます')).toBeNull()
  expect(onMark).not.toHaveBeenCalled()
  expect(decode).toHaveBeenCalledTimes(1)
  expect(decode.mock.calls[0][0]).toBeInstanceOf(Blob) // the file's own bytes, never a network fetch
  expect(revoked).toEqual(['blob:mark-1'])
})

it('d2 a PNG that decodes is accepted at its size, and the decoded bitmap is released', async () => {
  const close = jest.fn()
  decode.mockResolvedValue({ width: 512, height: 512, close })
  const { onMark, pick } = mount()
  pick(fileOf(PNG_HEAD, 'ok.png'))
  await waitFor(() => expect(onMark).toHaveBeenCalledWith({ cause: 'picked', mark: { url: 'blob:mark-1', width: 512, height: 512 } }))
  expect(screen.getByText('このロゴを使えます')).toBeTruthy()
  expect(close).toHaveBeenCalledTimes(1)
})

it('d3 the refusal order holds: a GIF is refused by its bytes before any decode', async () => {
  const { pick } = mount()
  pick(fileOf(GIF_HEAD, 'mark.png'))
  expect(await screen.findByRole('alert')).toHaveTextContent(MARK_REFUSAL.type)
  expect(decode).not.toHaveBeenCalled()
})

it('d4 R263: a header claiming 20000×20000 square gets the size refusal (L5) and is NEVER decoded', async () => {
  headerSide = 20000
  decode.mockResolvedValue({ width: 20000, height: 20000, close: () => {} })
  const { onMark, pick } = mount()
  pick(fileOf(PNG_HEAD, 'huge.png'))
  expect(await screen.findByRole('alert')).toHaveTextContent(MARK_REFUSAL.large)
  expect(decode).not.toHaveBeenCalled()
  expect(onMark).not.toHaveBeenCalled()
  expect(revoked).toEqual(['blob:mark-1'])
})

it('d5 R263: with no createImageBitmap at all (an old browser) a good header is still accepted', async () => {
  delete g.createImageBitmap
  const { onMark, pick } = mount()
  pick(fileOf(PNG_HEAD, 'ok.png'))
  await waitFor(() => expect(onMark).toHaveBeenCalledWith({ cause: 'picked', mark: { url: 'blob:mark-1', width: 512, height: 512 } }))
})

// ⚖ S67 P10 R3 — the turn guard AFTER the decode await: a newer pick arriving while an older pick is still decoding.
// A's injected decode is held open; B is picked and accepted; then A's decode settles. A's object URL is revoked and
// A's result (accept for d6, type refusal for d7) never reaches the parent or the screen; B's result stands.
const raceAB = async (settleA: (gate: { resolve: () => void; reject: (e: unknown) => void }) => void) => {
  type Gate = { open: boolean; resolve: () => void; reject: (e: unknown) => void }
  const gate: Gate = { open: false, resolve: () => {}, reject: () => {} }
  let calls = 0
  const seam = jest.fn((): Promise<void> => (++calls === 1
    ? new Promise<void>((resolve, reject) => { Object.assign(gate, { open: true, resolve, reject }) })
    : Promise.resolve()))
  const onMark = jest.fn()
  render(<CardMarkBlock practice onMark={onMark} decode={seam} />)
  const pick = (f: File) => fireEvent.change(screen.getByTestId('card-mark-file'), { target: { files: [f] } })
  pick(fileOf(PNG_HEAD, 'a.png'))
  await waitFor(() => expect(seam).toHaveBeenCalledTimes(1)) // A is now inside decode, pending
  pick(fileOf(PNG_HEAD, 'b.png'))
  await waitFor(() => expect(onMark).toHaveBeenCalledWith({ cause: 'picked', mark: { url: 'blob:mark-2', width: 512, height: 512 } }))
  expect(gate.open).toBe(true) // A's decode is still pending while B is accepted
  await act(async () => { settleA(gate); await new Promise((r) => setTimeout(r, 0)) })
  return { onMark, seam }
}

it('d6 R263 turn guard: a newer pick arriving DURING the older pick\'s decode wins; the older decode passing later changes nothing', async () => {
  const { onMark, seam } = await raceAB((gate) => gate.resolve())
  expect(seam).toHaveBeenCalledTimes(2)
  expect(onMark).toHaveBeenCalledTimes(1) // B only — A never reaches the parent
  expect(onMark).not.toHaveBeenCalledWith(expect.objectContaining({ mark: expect.objectContaining({ url: 'blob:mark-1' }) }))
  expect(revoked).toEqual(['blob:mark-1']) // A's URL revoked; B's held URL untouched
  expect(screen.getByText('b.png')).toBeTruthy()
  expect(screen.queryByText('a.png')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('d7 R263 turn guard: the older pick\'s decode FAILING after a newer pick shows no type refusal and keeps B', async () => {
  const { onMark } = await raceAB((gate) => gate.reject(new DOMException('The source image could not be decoded.', 'InvalidStateError')))
  expect(onMark).toHaveBeenCalledTimes(1) // no { cause: 'refused' } for A
  expect(onMark).not.toHaveBeenCalledWith(expect.objectContaining({ cause: 'refused' }))
  expect(revoked).toEqual(['blob:mark-1'])
  expect(screen.queryByRole('alert')).toBeNull() // A's type refusal never shown
  expect(screen.getByText('このロゴを使えます')).toBeTruthy()
  expect(screen.getByText('b.png')).toBeTruthy()
})
