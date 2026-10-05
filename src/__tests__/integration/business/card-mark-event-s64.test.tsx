/** @jest-environment jsdom */
// S64 R239: the block's event names its cause — picked · removed · refused (only when a mark was held).
// A refusal and the owner's remove are different events; a refused pick never reads as a removal.
// R193 pins: JPEG and WebP magic bytes type the object URL, never the file's declared type.
import { render, fireEvent, cleanup, screen, waitFor, act } from '@testing-library/react'
import { CardMarkBlock } from '@/app/[locale]/(business)/business/settings/CardMarkBlock'
import { MARK_REFUSAL } from '@/business/lib/store-page/card-mark'

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const GIF_HEAD = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0x01]
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
function fileOf(head: number[], name: string, type: string, total = head.length): File {
  const bytes = new Uint8Array(total); bytes.set(head); return new File([bytes], name, { type })
}
let made = 0
const created: string[] = []
const blobs: Blob[] = []
beforeEach(() => {
  made = 0; created.length = 0; blobs.length = 0
  Object.assign(URL, {
    createObjectURL: (b: Blob) => { const u = `blob:mark-${++made}`; created.push(u); blobs.push(b); return u },
    revokeObjectURL: () => {},
  })
})
afterEach(cleanup)
type Size = { width: number; height: number }
function deferred() { let res!: (s: Size) => void; const p = new Promise<Size>((a) => { res = a }); return { p, res } }
const pickOn = (f: File) => fireEvent.change(screen.getByTestId('card-mark-file'), { target: { files: [f] } })
const removeBtn = (c: HTMLElement) => c.querySelector('button.cm-rm') as HTMLButtonElement
const causes = (fn: jest.Mock) => fn.mock.calls.map(c => (c[0] as { cause?: string } | null)?.cause ?? String(c[0]))

it('e1 a good pick → exactly ONE event, picked, carrying the created URL and the measured size', async () => {
  const onMark = jest.fn()
  render(<CardMarkBlock practice onMark={onMark} measure={async () => ({ width: 640, height: 640 })} />)
  pickOn(fileOf(PNG_HEAD, 'good.png', 'image/png')); await screen.findByText('good.png')
  expect(onMark.mock.calls).toEqual([[{ cause: 'picked', mark: { url: created[0], width: 640, height: 640 } }]])
})

it('e2 good, then remove → the second event is removed; refused is never emitted', async () => {
  const onMark = jest.fn()
  const { container } = render(<CardMarkBlock practice onMark={onMark} measure={async () => ({ width: 512, height: 512 })} />)
  pickOn(fileOf(PNG_HEAD, 'good.png', 'image/png')); await screen.findByText('good.png')
  fireEvent.click(removeBtn(container))
  expect(onMark).toHaveBeenCalledTimes(2)
  expect(onMark.mock.calls[1]).toEqual([{ cause: 'removed' }])
  expect(causes(onMark)).not.toContain('refused')
})

it('e3 good, then a pick refused EARLY (wrong bytes) → refused / type; never removed', async () => {
  const onMark = jest.fn()
  render(<CardMarkBlock practice onMark={onMark} measure={async () => ({ width: 512, height: 512 })} />)
  pickOn(fileOf(PNG_HEAD, 'good.png', 'image/png')); await screen.findByText('good.png')
  pickOn(fileOf(GIF_HEAD, 'bad.png', 'image/png'))
  expect(await screen.findByRole('alert')).toHaveTextContent(MARK_REFUSAL.type)
  expect(onMark).toHaveBeenLastCalledWith({ cause: 'refused', why: 'type' })
  expect(causes(onMark)).toEqual(['picked', 'refused'])
})

it('e4 good, then a pick refused LATE (not square) → refused / square; never removed', async () => {
  const onMark = jest.fn(); let n = 0
  render(<CardMarkBlock practice onMark={onMark} measure={async () => (++n === 1 ? { width: 512, height: 512 } : { width: 512, height: 400 })} />)
  pickOn(fileOf(PNG_HEAD, 'good.png', 'image/png')); await screen.findByText('good.png')
  pickOn(fileOf(PNG_HEAD, 'wide.png', 'image/png'))
  expect(await screen.findByRole('alert')).toHaveTextContent(MARK_REFUSAL.square)
  expect(onMark).toHaveBeenLastCalledWith({ cause: 'refused', why: 'square' })
  expect(causes(onMark)).toEqual(['picked', 'refused'])
})

it('e5 a refused FIRST pick (nothing held) emits NOTHING; the next good pick is the only event', async () => {
  const onMark = jest.fn()
  render(<CardMarkBlock practice onMark={onMark} measure={async () => ({ width: 512, height: 512 })} />)
  pickOn(fileOf(GIF_HEAD, 'bad.png', 'image/png'))
  expect(await screen.findByRole('alert')).toHaveTextContent(MARK_REFUSAL.type)
  expect(onMark).not.toHaveBeenCalled()
  pickOn(fileOf(PNG_HEAD, 'good.png', 'image/png')); await screen.findByText('good.png')
  expect(onMark.mock.calls).toEqual([[{ cause: 'picked', mark: { url: 'blob:mark-1', width: 512, height: 512 } }]])
})

it('e6 remove while a pick is still measuring → removed exactly once; the late pick emits nothing', async () => {
  const onMark = jest.fn(); const slow = deferred(); let n = 0
  const { container } = render(<CardMarkBlock practice onMark={onMark} measure={() => (++n === 2 ? slow.p : Promise.resolve({ width: 300, height: 300 }))} />)
  pickOn(fileOf(PNG_HEAD, 'one.png', 'image/png')); await screen.findByText('one.png')
  pickOn(fileOf(PNG_HEAD, 'two.png', 'image/png')); await waitFor(() => expect(made).toBe(2))
  fireEvent.click(removeBtn(container))
  await act(async () => { slow.res({ width: 300, height: 300 }) })
  expect(onMark.mock.calls).toEqual([
    [{ cause: 'picked', mark: { url: 'blob:mark-1', width: 300, height: 300 } }],
    [{ cause: 'removed' }],
  ])
})

it('j1 R193: a JPEG-magic file declared text/html → the Blob handed to createObjectURL is image/jpeg', async () => {
  const onMark = jest.fn()
  render(<CardMarkBlock practice onMark={onMark} measure={async () => ({ width: 300, height: 300 })} />)
  pickOn(fileOf(JPEG_HEAD, 'evil.html', 'text/html')); await screen.findByText('evil.html')
  expect(blobs).toHaveLength(1)
  expect(blobs[0].type).toBe('image/jpeg')
  expect(onMark.mock.calls).toEqual([[{ cause: 'picked', mark: { url: 'blob:mark-1', width: 300, height: 300 } }]])
})

it('w1 R193: a RIFF….WEBP file declared image/png → the Blob handed to createObjectURL is image/webp', async () => {
  const onMark = jest.fn()
  render(<CardMarkBlock practice onMark={onMark} measure={async () => ({ width: 300, height: 300 })} />)
  pickOn(fileOf(WEBP_HEAD, 'mark.png', 'image/png')); await screen.findByText('mark.png')
  expect(blobs).toHaveLength(1)
  expect(blobs[0].type).toBe('image/webp')
  expect(onMark.mock.calls).toEqual([[{ cause: 'picked', mark: { url: 'blob:mark-1', width: 300, height: 300 } }]])
})
