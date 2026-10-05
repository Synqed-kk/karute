/** @jest-environment jsdom */
// CardMarkBlock — refusals, accept → onMark with size, 外す → null + URL revoked, never the room's values.
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/react'
import { CardMarkBlock, MARK_PRACTICE_LINE, MARK_REAL_LINE } from '@/app/[locale]/(business)/business/settings/CardMarkBlock'
import { MARK_MAX_BYTES, MARK_REFUSAL } from '@/business/lib/store-page/card-mark'

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]
const GIF_HEAD = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0] // GIF89a

function fileOf(head: number[], name: string, type: string, total = head.length): File {
  const bytes = new Uint8Array(total)
  bytes.set(head)
  return new File([bytes], name, { type })
}

let made = 0
const created: string[] = []
const revoked: string[] = []
beforeEach(() => {
  made = 0; created.length = 0; revoked.length = 0
  Object.assign(URL, {
    createObjectURL: () => { const u = `blob:mark-${++made}`; created.push(u); return u },
    revokeObjectURL: (u: string) => { revoked.push(u) },
  })
})
afterEach(cleanup)

function mount(size: { width: number; height: number }) {
  const onMark = jest.fn()
  const view = render(<CardMarkBlock practice onMark={onMark} measure={async () => size} />)
  const pick = (f: File) => fireEvent.change(screen.getByTestId('card-mark-file'), { target: { files: [f] } })
  return { onMark, view, pick }
}

it('a GIF named .png with an image/png type is refused by its bytes (L1)', async () => {
  const { onMark, pick } = mount({ width: 512, height: 512 })
  pick(fileOf(GIF_HEAD, 'mark.png', 'image/png'))
  expect(await screen.findByRole('alert')).toHaveTextContent(MARK_REFUSAL.type)
  expect(onMark).not.toHaveBeenCalled()
  expect(created).toEqual([])
})

it('2 MB + 1 byte is refused (L2); exactly 2 MB passes', async () => {
  const { onMark, pick } = mount({ width: 512, height: 512 })
  pick(fileOf(PNG_HEAD, 'big.png', 'image/png', MARK_MAX_BYTES + 1))
  expect(await screen.findByRole('alert')).toHaveTextContent(MARK_REFUSAL.bytes)
  pick(fileOf(PNG_HEAD, 'ok.png', 'image/png', MARK_MAX_BYTES))
  await waitFor(() => expect(onMark).toHaveBeenCalledWith({ url: 'blob:mark-1', width: 512, height: 512 }))
})

it.each([
  [{ width: 512, height: 511 }, null],
  [{ width: 512, height: 509 }, MARK_REFUSAL.square],
  [{ width: 255, height: 255 }, MARK_REFUSAL.small],
  [{ width: 2049, height: 2049 }, MARK_REFUSAL.large],
])('pixel size %o', async (size, refusal) => {
  const { onMark, pick } = mount(size)
  pick(fileOf(PNG_HEAD, 'm.png', 'image/png'))
  if (refusal === null) {
    await waitFor(() => expect(onMark).toHaveBeenCalledWith({ url: 'blob:mark-1', ...size }))
    expect(screen.queryByRole('alert')).toBeNull()
  } else {
    expect(await screen.findByRole('alert')).toHaveTextContent(refusal)
    expect(onMark).not.toHaveBeenCalled()
    expect(revoked).toEqual(['blob:mark-1'])
  }
})

it('accept shows the file; replace revokes the old URL; 外す → null + revoked; unmount revokes', async () => {
  const { onMark, pick, view } = mount({ width: 300, height: 300 })
  pick(fileOf(PNG_HEAD, 'first.png', 'image/png'))
  expect(await screen.findByText('first.png')).toBeInTheDocument()
  expect(screen.getByText('このロゴを使えます')).toBeInTheDocument()
  pick(fileOf(PNG_HEAD, 'second.png', 'image/png'))
  expect(await screen.findByText('second.png')).toBeInTheDocument()
  expect(revoked).toEqual(['blob:mark-1'])
  fireEvent.click(screen.getByRole('button', { name: '外す' }))
  expect(onMark).toHaveBeenLastCalledWith(null)
  expect(revoked).toEqual(['blob:mark-1', 'blob:mark-2'])
  expect(screen.queryByText('second.png')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'ロゴ画像を選ぶ' }))
  pick(fileOf(PNG_HEAD, 'third.png', 'image/png'))
  await screen.findByText('third.png')
  view.unmount()
  expect(revoked).toEqual(['blob:mark-1', 'blob:mark-2', 'blob:mark-3'])
})

it('practice shows L6 and the picker; a real business shows L7 and no picker', () => {
  const { view } = mount({ width: 300, height: 300 })
  expect(screen.getByText(MARK_PRACTICE_LINE)).toBeInTheDocument()
  view.unmount()
  render(<CardMarkBlock practice={false} onMark={jest.fn()} />)
  expect(screen.getByText(MARK_REAL_LINE)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'ロゴ画像を選ぶ' })).toBeNull()
  expect(screen.queryByTestId('card-mark-file')).toBeNull()
})
