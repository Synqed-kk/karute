// card-mark.ts — CORE-55's technical rules, behaviour pins (D-LOGO).
import {
  MARK_MAX_BYTES, MARK_REFUSAL, checkMarkFile, checkMarkSize, sniffMarkFormat,
} from '@/business/lib/store-page/card-mark'

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])
const gif = new TextEncoder().encode('GIF89a\0\0\0\0\0\0')

describe('format by magic bytes', () => {
  it('knows PNG, JPEG and WebP', () => {
    expect(sniffMarkFormat(png)).toBe('png')
    expect(sniffMarkFormat(jpeg)).toBe('jpeg')
    expect(sniffMarkFormat(webp)).toBe('webp')
  })
  it('refuses anything else, including a RIFF that is not WebP and a short head', () => {
    expect(sniffMarkFormat(gif)).toBeNull()
    expect(sniffMarkFormat(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20]))).toBeNull()
    expect(sniffMarkFormat(png.slice(0, 7))).toBeNull()
    expect(checkMarkFile(gif, 10)).toBe('type')
  })
})

describe('byte size ≤ 2 MB', () => {
  it('accepts exactly 2 MB and refuses one byte more', () => {
    expect(MARK_MAX_BYTES).toBe(2_000_000)
    expect(checkMarkFile(png, 2_000_000)).toBeNull()
    expect(checkMarkFile(png, 2_000_001)).toBe('bytes')
  })
  it('checks the format before the size', () => {
    expect(checkMarkFile(gif, MARK_MAX_BYTES + 1)).toBe('type')
  })
})

describe('pixel size', () => {
  it('square within ±1 px', () => {
    expect(checkMarkSize(512, 511)).toBeNull()
    expect(checkMarkSize(511, 512)).toBeNull()
    expect(checkMarkSize(512, 510)).toBe('square')
    expect(checkMarkSize(512, 509)).toBe('square')
  })
  it('256–2048 px', () => {
    expect(checkMarkSize(256, 256)).toBeNull()
    expect(checkMarkSize(2048, 2048)).toBeNull()
    expect(checkMarkSize(255, 255)).toBe('small')
    expect(checkMarkSize(256, 255)).toBe('small')
    expect(checkMarkSize(2049, 2049)).toBe('large')
    expect(checkMarkSize(2048, 2049)).toBe('large')
  })
  it('a size that cannot be read is refused as the format', () => {
    expect(checkMarkSize(0, 0)).toBe('type')
    expect(checkMarkSize(Number.NaN, 300)).toBe('type')
  })
})

it('every refusal has its COPY-S49 line', () => {
  expect(MARK_REFUSAL.type).toBe('このファイル形式には対応していません。PNG・JPEG・WebP形式の画像を選んでください。')
  expect(MARK_REFUSAL.bytes).toBe('ファイルサイズが大きすぎます。2MB以下の画像を選んでください。')
  expect(MARK_REFUSAL.square).toBe('この画像は正方形ではありません。正方形（縦と横が同じ長さ）の画像を選んでください。')
  expect(MARK_REFUSAL.small).toBe('画像が小さすぎます。縦横256px以上の画像を選んでください。')
  expect(MARK_REFUSAL.large).toBe('画像が大きすぎます。縦横2048px以下の画像を選んでください。')
})
