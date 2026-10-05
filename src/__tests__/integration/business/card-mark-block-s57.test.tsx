/** @jest-environment jsdom */
// S57 fix round (P8a): R191 a refused pick clears the held mark · the four turn guards (attack A2, A3, A4) ·
// R193 the object URL is typed by the sniffed format (A10) · R192 the byte limit is 2 000 000.
import { render, fireEvent, cleanup, screen, waitFor, act } from '@testing-library/react'
import { CardMarkBlock } from '@/app/[locale]/(business)/business/settings/CardMarkBlock'
import { MARK_REFUSAL } from '@/business/lib/store-page/card-mark'

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const GIF_HEAD = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]
function fileOf(head: number[], name: string, type: string, total = head.length): File {
  const bytes = new Uint8Array(total); bytes.set(head); return new File([bytes], name, { type })
}
let made = 0
const created: string[] = []
const revoked: string[] = []
const blobs: Blob[] = []
beforeEach(() => {
  made = 0; created.length = 0; revoked.length = 0; blobs.length = 0
  Object.assign(URL, {
    createObjectURL: (b: Blob) => { const u = `blob:mark-${++made}`; created.push(u); blobs.push(b); return u },
    revokeObjectURL: (u: string) => { revoked.push(u) },
  })
})
afterEach(cleanup)
type Size = { width: number; height: number }
function deferred() { let res!: (s: Size) => void; let rej!: (e: Error) => void; const p = new Promise<Size>((a, b) => { res = a; rej = b }); return { p, res, rej } }
const pickOn = (f: File) => fireEvent.change(screen.getByTestId('card-mark-file'), { target: { files: [f] } })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 20)) })

it('A1 R191: good then bad (early refusal) → the alert alone, the held mark cleared', async () => {
  const onMark = jest.fn()
  render(<CardMarkBlock practice onMark={onMark} measure={async () => ({ width: 512, height: 512 })} />)
  pickOn(fileOf(PNG_HEAD, 'good.png', 'image/png')); await screen.findByText('good.png')
  pickOn(fileOf(GIF_HEAD, 'bad.png', 'image/png'))
  expect(await screen.findByRole('alert')).toHaveTextContent(MARK_REFUSAL.type)
  expect(screen.queryByText('このロゴを使えます')).toBeNull()
  expect(screen.queryByText('good.png')).toBeNull()
  expect(onMark).toHaveBeenLastCalledWith({ cause: 'refused', why: 'type' })
  expect(onMark.mock.calls.filter(c => c[0].cause !== 'picked')).toHaveLength(1)
  expect(revoked).toEqual(['blob:mark-1'])
  // a good pick after the refusal clears the refusal
  pickOn(fileOf(PNG_HEAD, 'again.png', 'image/png')); await screen.findByText('again.png')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(onMark).toHaveBeenLastCalledWith({ cause: 'picked', mark: { url: 'blob:mark-2', width: 512, height: 512 } })
})

it('A1b R191: good then bad (late refusal, not square) → the alert alone, both URLs revoked', async () => {
  const onMark = jest.fn(); let n = 0
  render(<CardMarkBlock practice onMark={onMark} measure={async () => (++n === 1 ? { width: 512, height: 512 } : { width: 512, height: 400 })} />)
  pickOn(fileOf(PNG_HEAD, 'good.png', 'image/png')); await screen.findByText('good.png')
  pickOn(fileOf(PNG_HEAD, 'wide.png', 'image/png'))
  expect(await screen.findByRole('alert')).toHaveTextContent(MARK_REFUSAL.square)
  expect(screen.queryByText('このロゴを使えます')).toBeNull()
  expect(screen.queryByText('good.png')).toBeNull()
  expect(onMark).toHaveBeenLastCalledWith({ cause: 'refused', why: 'square' })
  expect(onMark.mock.calls.filter(c => c[0].cause !== 'picked')).toHaveLength(1)
  expect([...revoked].sort()).toEqual(['blob:mark-1', 'blob:mark-2'])
})

it('A2 stale guard: first pick finishes LAST is dropped and its URL revoked', async () => {
  const onMark = jest.fn(); const slow = deferred(); let n = 0
  const v = render(<CardMarkBlock practice onMark={onMark} measure={() => (++n === 1 ? slow.p : Promise.resolve({ width: 400, height: 400 }))} />)
  pickOn(fileOf(PNG_HEAD, 'first.png', 'image/png')); await waitFor(() => expect(made).toBe(1))
  pickOn(fileOf(PNG_HEAD, 'second.png', 'image/png')); await screen.findByText('second.png')
  await act(async () => { slow.res({ width: 300, height: 300 }) })
  expect(onMark.mock.calls).toEqual([[{ cause: 'picked', mark: { url: 'blob:mark-2', width: 400, height: 400 } }]])
  expect(screen.getByText('second.png')).toBeInTheDocument()
  expect(revoked).toEqual(['blob:mark-1'])
  v.unmount(); expect(revoked).toEqual(['blob:mark-1', 'blob:mark-2'])
})

it('A3 unmount during the head read: no URL is ever made', async () => {
  const onMark = jest.fn()
  const v = render(<CardMarkBlock practice onMark={onMark} measure={async () => ({ width: 512, height: 512 })} />)
  pickOn(fileOf(PNG_HEAD, 'a.png', 'image/png')); v.unmount(); await flush()
  expect(created).toEqual([]); expect(onMark).not.toHaveBeenCalled()
})

it('A4 外す while a pick is still measuring: the late pick never lands', async () => {
  const onMark = jest.fn(); const slow = deferred(); let n = 0
  render(<CardMarkBlock practice onMark={onMark} measure={() => (++n === 2 ? slow.p : Promise.resolve({ width: 300, height: 300 }))} />)
  pickOn(fileOf(PNG_HEAD, 'one.png', 'image/png')); await screen.findByText('one.png')
  pickOn(fileOf(PNG_HEAD, 'two.png', 'image/png')); await waitFor(() => expect(made).toBe(2))
  fireEvent.click(screen.getByRole('button', { name: '外す' }))
  await act(async () => { slow.res({ width: 300, height: 300 }) })
  expect(onMark).toHaveBeenLastCalledWith({ cause: 'removed' }); expect(screen.queryByText('two.png')).toBeNull()
  expect([...revoked].sort()).toEqual(['blob:mark-1', 'blob:mark-2'])
})

it('A10 R193: a PNG-magic file declared text/html → the Blob handed to createObjectURL is image/png', async () => {
  const onMark = jest.fn()
  render(<CardMarkBlock practice onMark={onMark} measure={async () => ({ width: 300, height: 300 })} />)
  pickOn(fileOf(PNG_HEAD, 'evil.html', 'text/html')); await screen.findByText('evil.html')
  expect(blobs).toHaveLength(1)
  expect(blobs[0].type).toBe('image/png')
})

it('R192: exactly 2 000 000 bytes is accepted, 2 000 001 is refused (L2)', async () => {
  const onMark = jest.fn()
  render(<CardMarkBlock practice onMark={onMark} measure={async () => ({ width: 512, height: 512 })} />)
  pickOn(fileOf(PNG_HEAD, 'big.png', 'image/png', 2_000_001))
  expect(await screen.findByRole('alert')).toHaveTextContent(MARK_REFUSAL.bytes)
  expect(created).toEqual([])
  pickOn(fileOf(PNG_HEAD, 'ok.png', 'image/png', 2_000_000)); await screen.findByText('ok.png')
  expect(screen.queryByRole('alert')).toBeNull()
})
